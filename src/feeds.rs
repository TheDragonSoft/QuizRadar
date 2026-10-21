use crate::models::{Assessment, ScheduleData};
use crate::moodle::parse_moodle_ics_content;
use std::sync::LazyLock;
use std::time::Duration;

/// Upper bound on subscribed feeds so one config can never turn a single sync
/// into an unbounded fan-out of HTTP requests.
pub const MAX_FEEDS: usize = 10;

static FEED_HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(15))
        .build()
        .expect("Failed to build shared calendar feed HTTP client")
});

/// A feed URL usually embeds a personal access token, so it must never be
/// fetched over plaintext HTTP.
pub fn validate_feed_url(url: &str) -> Result<(), String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("Feed URL is empty.".to_string());
    }
    if trimmed.to_lowercase().starts_with("http://") {
        return Err(
            "Feed URL must use HTTPS (http:// would send any access token embedded in the link in the clear). Re-copy the link starting with https://."
                .to_string(),
        );
    }
    if !trimmed.to_lowercase().starts_with("https://") {
        return Err("Feed URL must be an https:// link to an .ics calendar file.".to_string());
    }
    Ok(())
}

/// Download and parse a generic university .ics subscription feed. The Moodle
/// ICS parser is reused deliberately: any RFC 5545 VEVENT feed works the same
/// way, and it already matches events against the student's courses/slots.
/// `name` is the user's label for the feed and becomes each item's `source`.
pub async fn fetch_feed(
    url: &str,
    name: &str,
    schedule: &ScheduleData,
) -> Result<Vec<Assessment>, String> {
    validate_feed_url(url)?;

    let resp = FEED_HTTP_CLIENT
        .get(url.trim())
        .send()
        .await
        .map_err(|e| format!("Failed to connect to calendar feed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Feed server responded with HTTP {}", resp.status()));
    }

    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !text.contains("BEGIN:") {
        // A login page or error blob parsing as "0 events" would look like a
        // silently broken subscription; be honest that this isn't iCalendar.
        return Err(
            "The URL did not return an iCalendar (.ics) file. Use the direct calendar export/subscription link."
                .to_string(),
        );
    }

    let mut items = parse_moodle_ics_content(&text, schedule, Some(url));
    for a in &mut items {
        // Re-brand the Moodle-prefixed ids so feed items never collide with —
        // or get filtered as — real Moodle LMS items.
        a.id = format!("feed-{}", a.id.trim_start_matches("moodle-"));
        a.source = name.to_string();
        a.source_icon = "calendar".to_string();
        a.email_subject = format!("Feed: {}", name);
        a.warnings = vec![format!(
            "📅 Synced from your subscribed calendar feed \"{}\".",
            name
        )];
        a.ai_inference_note = "Synced from a subscribed university .ics calendar feed.".to_string();
        // The Moodle parser appends a Moodle-portal fallback URL when a VEVENT
        // carries no link; for a generic feed the honest link is the feed URL.
        if a.elearning_url
            .ends_with("/calendar/view.php?view=upcoming")
        {
            a.elearning_url = url.trim().to_string();
        }
    }
    Ok(items)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_feed_url() {
        assert!(validate_feed_url("https://uni.edu/timetable.ics").is_ok());
        assert!(validate_feed_url("HTTPS://UNI.EDU/FEED.ICS").is_ok());
        assert!(validate_feed_url("  https://uni.edu/t?token=abc  ").is_ok());

        assert!(validate_feed_url("").is_err());
        assert!(validate_feed_url("   ").is_err());
        assert!(validate_feed_url("http://uni.edu/timetable.ics").is_err());
        assert!(validate_feed_url("ftp://uni.edu/timetable.ics").is_err());
        assert!(validate_feed_url("uni.edu/timetable.ics").is_err());
        assert!(validate_feed_url("https:/uni.edu/typo.ics").is_err());
    }
}
