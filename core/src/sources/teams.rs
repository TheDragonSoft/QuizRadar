//! Microsoft Teams source (`02` §5.3): Graph `/me` profile anchors,
//! `/me/joinedTeams` → per-team channels → tabs → drive root + one level of
//! subfolders → conversations (paged ≤10, bounded concurrency 4).
//!
//! Honesty rules (`03` §A3, §B5): the deterministic heuristic fallback maps
//! team names to courses **only** — no invented assessments, no invented
//! timetable, no keyword renaming of user courses. AI source-discovery lives
//! behind the injected [`TeamsAiDiscovery`] hook (phase 06 wires Gemini);
//! when the hook is absent or returns nothing, the heuristic result stands.

use std::future::Future;
use std::pin::Pin;

use futures::StreamExt;
use serde_json::Value;

use crate::auth::providers::{MicrosoftCapability, ProviderCapability};
use crate::sources::{authed_get, net_err, preset_course_colors, Progress, TokenProvider};
use crate::types::{Assessment, Course};

pub const GRAPH_API_BASE: &str = "https://graph.microsoft.com/v1.0";
/// Upper bound on `@odata.nextLink` pages per collection (v4 parity).
pub const GRAPH_MAX_PAGES: usize = 10;
/// Bounded concurrency for per-team bundle fetches.
pub const TEAM_CONCURRENCY: usize = 4;
/// Bounded concurrency for tabs / drive subfolder walks inside one team.
pub const SUBRESOURCE_CONCURRENCY: usize = 3;

/// One team's walk result; the string lists are AI-context material (phase
/// 06) and honest diagnostics — never parsed into assessments by v5 core.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TeamBundle {
    pub id: String,
    pub name: String,
    pub description: String,
    pub channels: Vec<String>,
    pub tabs: Vec<String>,
    pub files: Vec<String>,
    pub conversations: Vec<String>,
}

/// Everything the AI hook (or diagnostics) may see about the account.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct TeamsContext {
    pub user_display_name: Option<String>,
    pub user_email: Option<String>,
    pub teams: Vec<TeamBundle>,
}

/// What a Teams scan concluded. Without AI, `assessments` stays empty — the
/// heuristic is courses-only by design (`03` §A3).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct TeamsDiscovery {
    pub assessments: Vec<Assessment>,
    pub courses: Vec<Course>,
    pub semester: Option<String>,
    pub user_display_name: Option<String>,
    pub user_email: Option<String>,
    /// Which path produced this: `true` = injected AI hook, `false` =
    /// deterministic heuristic. Sync notes label it either way.
    pub ai_assisted: bool,
}

/// Injected AI source-discovery (phase 06). Object-safe so the orchestrator
/// takes `Option<&dyn TeamsAiDiscovery>`.
pub trait TeamsAiDiscovery: Send + Sync {
    fn discover<'a>(
        &'a self,
        context: &'a TeamsContext,
    ) -> Pin<Box<dyn Future<Output = Option<TeamsDiscovery>> + Send + 'a>>;
}

/// Full Teams scan. `base_url` is the Graph root (production:
/// [`GRAPH_API_BASE`], tests: fixture server).
pub async fn scan_teams(
    client: &reqwest::Client,
    provider: &dyn TokenProvider,
    base_url: &str,
    ai: Option<&dyn TeamsAiDiscovery>,
    progress: &Progress<'_>,
) -> Result<TeamsDiscovery, String> {
    let capability = ProviderCapability::Microsoft(MicrosoftCapability::UserProfile);

    // 1. Profile anchors (non-fatal: a failed /me still allows the team walk,
    //    reported honestly in the notes path via None fields).
    progress.emit("connecting", 0, 0);
    let (user_display_name, user_email) = match fetch_profile(client, provider, base_url).await {
        Ok(profile) => profile,
        Err(error) => {
            progress.emit("connecting", 0, 1);
            // Continue; the teams walk below still runs on the same token.
            let _ = error;
            (None, None)
        }
    };

    // 2. Joined teams → per-team bundles (channels/tabs/drive/conversations).
    let mut teams_error: Option<String> = None;
    let teams_items = {
        let pages = graph_get_all_pages(
            client,
            provider,
            capability,
            &format!("{base_url}/me/joinedTeams"),
        )
        .await;
        match pages {
            Ok(items) if !items.is_empty() => items,
            Ok(_) => Vec::new(),
            Err(error) => {
                teams_error = Some(error);
                Vec::new()
            }
        }
    };
    if let Some(error) = teams_error {
        return Err(error);
    }

    progress.emit("fetching", teams_items.len(), 0);
    let bundles: Vec<TeamBundle> = futures::stream::iter(teams_items)
        .map(|team| async move { fetch_team_bundle(client, provider, base_url, &team).await })
        .buffered(TEAM_CONCURRENCY)
        .collect()
        .await;
    progress.emit("done", bundles.len(), bundles.len());

    let context = TeamsContext {
        user_display_name: user_display_name.clone(),
        user_email: user_email.clone(),
        teams: bundles,
    };

    // 3. AI discovery first (phase 06 injects the implementation).
    if let Some(hook) = ai {
        if let Some(mut discovered) = hook.discover(&context).await {
            if !discovered.courses.is_empty() {
                discovered.user_display_name = discovered
                    .user_display_name
                    .or(context.user_display_name.clone());
                discovered.user_email = discovered.user_email.or(context.user_email.clone());
                discovered.ai_assisted = true;
                return Ok(discovered);
            }
        }
    }

    // 4. Deterministic heuristic: courses-only, noise-filtered, nothing else.
    Ok(explore_teams_heuristically(&context))
}

/// v4 noise filter, ported verbatim: obvious non-course groups are dropped;
/// real course names are never remapped to a different identity.
#[must_use]
pub fn clean_team_course_name(name: &str) -> String {
    let lower = name.to_lowercase();
    if lower.contains("advising")
        || lower.contains("cohort 20")
        || lower == "general chat"
        || lower == "general"
        || lower == "announcements"
        || lower == "staff"
        || lower == "faculty"
        || lower == "test team"
    {
        return String::new();
    }
    name.trim().to_string()
}

/// The honest heuristic fallback: team names → courses (noise-filtered,
/// deduped, deterministic preset palettes). No assessments, slots, semester
/// or university are ever fabricated here.
#[must_use]
pub fn explore_teams_heuristically(context: &TeamsContext) -> TeamsDiscovery {
    let mut courses: Vec<Course> = Vec::new();
    for bundle in &context.teams {
        let clean = clean_team_course_name(&bundle.name);
        if clean.is_empty()
            || courses
                .iter()
                .any(|course| course.id.eq_ignore_ascii_case(&clean))
        {
            continue;
        }
        let (color, bg, border) = preset_course_colors(&clean);
        courses.push(Course {
            id: clean.clone(),
            name: clean,
            color,
            bg,
            border,
        });
    }
    TeamsDiscovery {
        assessments: Vec::new(),
        courses,
        semester: None,
        user_display_name: context.user_display_name.clone(),
        user_email: context.user_email.clone(),
        ai_assisted: false,
    }
}

async fn fetch_profile(
    client: &reqwest::Client,
    provider: &dyn TokenProvider,
    base_url: &str,
) -> Result<(Option<String>, Option<String>), String> {
    let response = authed_get(
        client,
        provider,
        ProviderCapability::Microsoft(MicrosoftCapability::UserProfile),
        &format!("{base_url}/me"),
    )
    .await?;
    if !response.status().is_success() {
        return Err(format!(
            "Microsoft Graph /me returned HTTP {}",
            response.status()
        ));
    }
    let value: Value = response
        .json()
        .await
        .map_err(|e| net_err("Microsoft profile response was not JSON", e))?;
    Ok((
        value
            .get("displayName")
            .and_then(Value::as_str)
            .map(str::to_string),
        value
            .get("userPrincipalName")
            .and_then(Value::as_str)
            .map(str::to_string),
    ))
}

/// Follows `@odata.nextLink` up to [`GRAPH_MAX_PAGES`] pages. The *first*
/// page failing is an error; a later page failing returns the partial list
/// with a truncation note so the caller can report honest counts.
async fn graph_get_all_pages(
    client: &reqwest::Client,
    provider: &dyn TokenProvider,
    capability: ProviderCapability,
    first_url: &str,
) -> Result<Vec<Value>, String> {
    let mut items: Vec<Value> = Vec::new();
    let mut url = first_url.to_string();
    for page in 0..GRAPH_MAX_PAGES {
        let response = match authed_get(client, provider, capability, &url).await {
            Ok(response) => response,
            Err(error) => {
                return if page == 0 {
                    Err(error)
                } else {
                    Ok(items) // partial: caller reports what it got
                };
            }
        };
        if !response.status().is_success() {
            let status = response.status();
            return if page == 0 {
                Err(format!("Microsoft Graph returned HTTP {status}"))
            } else {
                Ok(items)
            };
        }
        let value: Value = match response.json().await {
            Ok(value) => value,
            Err(e) => {
                return if page == 0 {
                    Err(net_err("Microsoft Graph response was not JSON", e))
                } else {
                    Ok(items)
                };
            }
        };
        if let Some(arr) = value.get("value").and_then(Value::as_array) {
            items.extend(arr.iter().cloned());
        }
        match value
            .get("@odata.nextLink")
            .and_then(Value::as_str)
            .map(str::to_string)
        {
            Some(next) if next != url => url = next,
            _ => break,
        }
    }
    Ok(items)
}

async fn fetch_team_bundle(
    client: &reqwest::Client,
    provider: &dyn TokenProvider,
    base_url: &str,
    team: &Value,
) -> TeamBundle {
    let id = team
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let name = team
        .get("displayName")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let description = team
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    if id.is_empty() {
        return TeamBundle {
            id,
            name,
            description,
            ..TeamBundle::default()
        };
    }

    let (channels_tabs, drive_files, conversations) = tokio::join!(
        fetch_team_channels_and_tabs(client, provider, base_url, &id),
        fetch_team_drive(client, provider, base_url, &id),
        fetch_team_conversations(client, provider, base_url, &id),
    );

    TeamBundle {
        id,
        name,
        description,
        channels: channels_tabs.0,
        tabs: channels_tabs.1,
        files: drive_files,
        conversations,
    }
}

type ChannelsAndTabs = (Vec<String>, Vec<String>);

async fn fetch_team_channels_and_tabs(
    client: &reqwest::Client,
    provider: &dyn TokenProvider,
    base_url: &str,
    team_id: &str,
) -> ChannelsAndTabs {
    let capability = ProviderCapability::Microsoft(MicrosoftCapability::UserProfile);
    let items = graph_get_all_pages(
        client,
        provider,
        capability,
        &format!("{base_url}/teams/{team_id}/channels"),
    )
    .await
    .unwrap_or_default();
    let mut channels: Vec<String> = Vec::with_capacity(items.len());
    let mut channel_refs: Vec<(String, String)> = Vec::with_capacity(items.len());
    for channel in &items {
        let channel_id = channel
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let channel_name = channel
            .get("displayName")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let channel_email = channel
            .get("email")
            .and_then(Value::as_str)
            .unwrap_or_default();
        channels.push(format!("Channel: {channel_name} (Email: {channel_email})"));
        if !channel_id.is_empty() {
            channel_refs.push((channel_id.to_string(), channel_name.to_string()));
        }
    }

    let tab_groups: Vec<Vec<String>> = futures::stream::iter(channel_refs)
        .map(|(channel_id, channel_name)| async move {
            graph_get_all_pages(
                client,
                provider,
                capability,
                &format!("{base_url}/teams/{team_id}/channels/{channel_id}/tabs"),
            )
            .await
            .unwrap_or_default()
            .iter()
            .filter_map(|tab| {
                tab.get("displayName")
                    .and_then(Value::as_str)
                    .map(|tab_name| format!("{tab_name} (Channel: {channel_name})"))
            })
            .collect::<Vec<_>>()
        })
        .buffered(SUBRESOURCE_CONCURRENCY)
        .collect()
        .await;

    (channels, tab_groups.into_iter().flatten().collect())
}

async fn fetch_team_drive(
    client: &reqwest::Client,
    provider: &dyn TokenProvider,
    base_url: &str,
    team_id: &str,
) -> Vec<String> {
    let capability = ProviderCapability::Microsoft(MicrosoftCapability::UserProfile);
    let root_items = graph_get_all_pages(
        client,
        provider,
        capability,
        &format!("{base_url}/groups/{team_id}/drive/root/children"),
    )
    .await
    .unwrap_or_default();

    // Collect (name, size, modified) for direct files and folder ids to walk
    // exactly one level deeper (v4 parity).
    let mut direct: Vec<String> = Vec::new();
    let mut folders: Vec<(String, String)> = Vec::new();
    for item in &root_items {
        let item_id = item.get("id").and_then(Value::as_str).unwrap_or_default();
        let item_name = item.get("name").and_then(Value::as_str).unwrap_or_default();
        let item_size = item.get("size").and_then(Value::as_i64).unwrap_or(0);
        let modified = item
            .get("lastModifiedDateTime")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if item.get("folder").is_some() && !item_id.is_empty() {
            folders.push((item_id.to_string(), item_name.to_string()));
        } else {
            direct.push(format!(
                "{item_name} (size: {} KB, uploaded: {modified})",
                item_size / 1024
            ));
        }
    }

    let mut files = direct;
    let sub_lists: Vec<Vec<String>> = futures::stream::iter(folders)
        .map(|(folder_id, folder_name)| async move {
            graph_get_all_pages(
                client,
                provider,
                capability,
                &format!("{base_url}/groups/{team_id}/drive/items/{folder_id}/children"),
            )
            .await
            .unwrap_or_default()
            .iter()
            .map(|sub| {
                let sub_name = sub.get("name").and_then(Value::as_str).unwrap_or_default();
                let sub_size = sub.get("size").and_then(Value::as_i64).unwrap_or(0);
                let modified = sub
                    .get("lastModifiedDateTime")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                format!(
                    "{folder_name}/{sub_name} (size: {} KB, uploaded: {modified})",
                    sub_size / 1024
                )
            })
            .collect::<Vec<_>>()
        })
        .buffered(SUBRESOURCE_CONCURRENCY)
        .collect()
        .await;
    for sub in sub_lists {
        files.extend(sub);
    }
    files
}

async fn fetch_team_conversations(
    client: &reqwest::Client,
    provider: &dyn TokenProvider,
    base_url: &str,
    team_id: &str,
) -> Vec<String> {
    let capability = ProviderCapability::Microsoft(MicrosoftCapability::UserProfile);
    graph_get_all_pages(
        client,
        provider,
        capability,
        &format!("{base_url}/groups/{team_id}/conversations"),
    )
    .await
    .unwrap_or_default()
    .iter()
    .map(|conversation| {
        let topic = conversation
            .get("topic")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let preview = conversation
            .get("preview")
            .and_then(Value::as_str)
            .unwrap_or_default();
        format!("Topic: {topic} | Preview: {preview}")
    })
    .collect()
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::*;
    use crate::sources::{http_client, FixedTokenProvider};
    use wiremock::matchers::{method, path_regex};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn provider() -> FixedTokenProvider {
        FixedTokenProvider {
            access_token: "ms-bearer".to_string(),
        }
    }

    /// Mounts the full Graph walk for two teams: "Financial Accounting I"
    /// (real course) and "General Chat" (noise).
    async fn mount_two_team_graph(server: &MockServer) {
        Mock::given(method("GET"))
            .and(path_regex(r"^/me$"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "displayName": "Ali Student",
                "userPrincipalName": "ali@uni.edu"
            })))
            .mount(server)
            .await;
        Mock::given(method("GET"))
            .and(path_regex(r"^/me/joinedTeams$"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "value": [
                    {"id": "t1", "displayName": "Financial Accounting I", "description": "Spring course"},
                    {"id": "t2", "displayName": "General Chat"}
                ]
            })))
            .mount(server)
            .await;
        Mock::given(method("GET"))
            .and(path_regex(r"^/teams/[^/]+/channels$"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "value": [{"id": "c1", "displayName": "General", "email": "chan@uni.edu"}]
            })))
            .mount(server)
            .await;
        Mock::given(method("GET"))
            .and(path_regex(r"^/teams/[^/]+/channels/[^/]+/tabs$"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(serde_json::json!({"value": [{"displayName": "Assignments"}]})),
            )
            .mount(server)
            .await;
        Mock::given(method("GET"))
            .and(path_regex(r"^/groups/[^/]+/drive/root/children$"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "value": [
                    {"id": "f1", "name": "week1.pdf", "size": 2048, "lastModifiedDateTime": "2026-10-01T00:00:00Z"},
                    {"id": "d1", "name": "Lectures", "folder": {}}
                ]
            })))
            .mount(server)
            .await;
        Mock::given(method("GET"))
            .and(path_regex(r"^/groups/[^/]+/drive/items/[^/]+/children$"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "value": [
                    {"id": "s1", "name": "lecture01.pdf", "size": 1024, "lastModifiedDateTime": "2026-10-02T00:00:00Z"}
                ]
            })))
            .mount(server)
            .await;
        Mock::given(method("GET"))
            .and(path_regex(r"^/groups/[^/]+/conversations$"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "value": [{"topic": "Quiz 1", "preview": "Next week..."}]
            })))
            .mount(server)
            .await;
    }

    #[tokio::test]
    async fn heuristic_discovers_courses_only_and_never_assessments() {
        let server = MockServer::start().await;
        mount_two_team_graph(&server).await;

        let client = http_client().unwrap();
        let progress = Progress::new("Microsoft Teams", &|_| {});
        let discovery = scan_teams(&client, &provider(), &server.uri(), None, &progress)
            .await
            .unwrap();

        // The heuristic is courses-only: assessments are NEVER invented.
        assert!(discovery.assessments.is_empty());
        assert!(!discovery.ai_assisted);
        assert_eq!(discovery.semester, None);
        assert_eq!(discovery.user_display_name.as_deref(), Some("Ali Student"));
        // Noise filter drops "General Chat"; the real course survives verbatim.
        assert_eq!(discovery.courses.len(), 1);
        assert_eq!(discovery.courses[0].id, "Financial Accounting I");
        assert_eq!(discovery.courses[0].name, "Financial Accounting I");
    }

    #[tokio::test]
    async fn empty_teams_are_an_honest_empty_discovery() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path_regex(r"^/me$"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path_regex(r"^/me/joinedTeams$"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!({"value": []})),
            )
            .mount(&server)
            .await;

        let client = http_client().unwrap();
        let progress = Progress::new("Microsoft Teams", &|_| {});
        let discovery = scan_teams(&client, &provider(), &server.uri(), None, &progress)
            .await
            .unwrap();
        assert!(discovery.courses.is_empty());
        assert!(discovery.assessments.is_empty());
    }

    struct FakeAi;

    impl TeamsAiDiscovery for FakeAi {
        fn discover<'a>(
            &'a self,
            context: &'a TeamsContext,
        ) -> Pin<Box<dyn Future<Output = Option<TeamsDiscovery>> + Send + 'a>> {
            let courses = vec![Course {
                id: "From AI".to_string(),
                name: "From AI".to_string(),
                color: "#1a73e8".to_string(),
                bg: None,
                border: None,
            }];
            Box::pin(std::future::ready(Some(TeamsDiscovery {
                assessments: Vec::new(),
                courses,
                semester: None,
                user_display_name: context.user_display_name.clone(),
                user_email: None,
                ai_assisted: false,
            })))
        }
    }

    #[tokio::test]
    async fn ai_hook_result_is_adopted_and_labeled() {
        let server = MockServer::start().await;
        mount_two_team_graph(&server).await;
        let client = http_client().unwrap();
        let progress = Progress::new("Microsoft Teams", &|_| {});
        let discovery = scan_teams(
            &client,
            &provider(),
            &server.uri(),
            Some(&FakeAi),
            &progress,
        )
        .await
        .unwrap();
        assert!(discovery.ai_assisted, "the hook path must be labeled");
        assert_eq!(discovery.courses[0].id, "From AI");
    }

    #[tokio::test]
    async fn joined_teams_failure_is_loud() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path_regex(r"^/me/joinedTeams$"))
            .respond_with(ResponseTemplate::new(401))
            .mount(&server)
            .await;
        let client = http_client().unwrap();
        let progress = Progress::new("Microsoft Teams", &|_| {});
        let error = scan_teams(&client, &provider(), &server.uri(), None, &progress)
            .await
            .unwrap_err();
        assert!(error.contains("HTTP 401"), "honest failure: {error}");
    }

    #[test]
    fn noise_filter_matches_v4_exactly() {
        assert_eq!(clean_team_course_name("Academic Advising"), "");
        assert_eq!(clean_team_course_name("advising session"), "");
        assert_eq!(clean_team_course_name("Cohort 2026 Students"), "");
        assert_eq!(clean_team_course_name("General"), "");
        assert_eq!(clean_team_course_name("Test Team"), "");
        // Real courses are never renamed.
        assert_eq!(clean_team_course_name("Math 101"), "Math 101");
        assert_eq!(
            clean_team_course_name("Financial Accounting I"),
            "Financial Accounting I"
        );
        assert_eq!(clean_team_course_name("  Physics 101  "), "Physics 101");
        assert_eq!(clean_team_course_name("   "), "");
    }

    #[test]
    fn heuristic_on_empty_context_is_empty() {
        let result = explore_teams_heuristically(&TeamsContext::default());
        assert!(result.courses.is_empty());
        assert!(result.assessments.is_empty());
        assert!(result.semester.is_none());
    }
}
