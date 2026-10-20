use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::LazyLock;
use std::time::Duration;
use tokio::io::AsyncWriteExt;

pub const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

static UPDATER_HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .user_agent(format!("QuizRadar/{}", CURRENT_VERSION))
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(120))
        .build()
        .expect("Failed to build shared updater HTTP client")
});

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub update_available: bool,
    pub current_version: String,
    pub latest_version: String,
    pub release_name: String,
    pub release_date: String,
    pub release_notes: String,
    pub download_url: Option<String>,
    pub portable_url: Option<String>,
    pub html_url: String,
}

pub async fn check_for_updates() -> Result<UpdateInfo, String> {
    let client = &*UPDATER_HTTP_CLIENT;

    let url = "https://api.github.com/repos/TheDragonSoft/QuizRadar/releases/latest";
    let resp = client
        .get(url)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("GitHub API returned status: {}", resp.status()));
    }

    let val: Value = resp.json().await.map_err(|e| e.to_string())?;

    let tag_name = val
        .get("tag_name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let release_name = val
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or(&tag_name)
        .to_string();
    let release_date = val
        .get("published_at")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let release_notes = val
        .get("body")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let html_url = val
        .get("html_url")
        .and_then(|v| v.as_str())
        .unwrap_or("https://github.com/TheDragonSoft/QuizRadar/releases")
        .to_string();

    let clean_latest = tag_name.trim_start_matches('v');
    let is_newer = is_version_newer(clean_latest, CURRENT_VERSION);

    let mut download_url = None;
    let mut portable_url = None;

    if let Some(assets) = val.get("assets").and_then(|a| a.as_array()) {
        for asset in assets {
            let name = asset.get("name").and_then(|n| n.as_str()).unwrap_or("");
            let url = asset
                .get("browser_download_url")
                .and_then(|u| u.as_str())
                .map(|s| s.to_string());
            if name.ends_with(".exe")
                && (name.contains("Setup")
                    || name.contains("installer")
                    || name.contains("quizradar"))
            {
                download_url = url.clone();
            } else if name.ends_with(".zip") && name.contains("Portable") {
                portable_url = url.clone();
            }
        }
    }

    // Fallback download url if specific asset not identified
    if download_url.is_none() {
        download_url = Some(format!(
            "https://github.com/TheDragonSoft/QuizRadar/releases/download/{}/QuizRadar-Setup-{}-x64.exe",
            tag_name, tag_name
        ));
    }

    Ok(UpdateInfo {
        update_available: is_newer,
        current_version: CURRENT_VERSION.to_string(),
        latest_version: tag_name,
        release_name,
        release_date,
        release_notes,
        download_url,
        portable_url,
        html_url,
    })
}

pub fn is_version_newer(latest: &str, current: &str) -> bool {
    let parse = |s: &str| -> Vec<u32> {
        s.split('.')
            .map(|p| {
                p.chars()
                    .take_while(|c| c.is_ascii_digit())
                    .collect::<String>()
            })
            .filter_map(|p| p.parse().ok())
            .collect()
    };

    let v_latest = parse(latest);
    let v_curr = parse(current);

    for (l, c) in v_latest.iter().zip(v_curr.iter()) {
        if l > c {
            return true;
        }
        if l < c {
            return false;
        }
    }
    v_latest.len() > v_curr.len()
}

pub async fn download_and_install_update(download_url: &str) -> Result<PathBuf, String> {
    let client = &*UPDATER_HTTP_CLIENT;

    let mut resp = client
        .get(download_url)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!(
            "Download failed with HTTP status: {}",
            resp.status()
        ));
    }

    let temp_file = std::env::temp_dir().join("QuizRadar-Setup-Update.exe");
    let mut file = tokio::fs::File::create(&temp_file)
        .await
        .map_err(|e| format!("Failed to create installer file: {}", e))?;

    loop {
        match resp.chunk().await {
            Ok(Some(chunk)) => {
                if let Err(e) = file.write_all(&chunk).await {
                    drop(file);
                    let _ = tokio::fs::remove_file(&temp_file).await;
                    return Err(format!("Failed to save installer: {}", e));
                }
            }
            Ok(None) => break,
            Err(e) => {
                drop(file);
                let _ = tokio::fs::remove_file(&temp_file).await;
                return Err(e.to_string());
            }
        }
    }
    if let Err(e) = file.flush().await {
        drop(file);
        let _ = tokio::fs::remove_file(&temp_file).await;
        return Err(format!("Failed to save installer: {}", e));
    }
    drop(file);

    // Spawn installer
    #[cfg(windows)]
    {
        let _ = std::process::Command::new(&temp_file)
            .spawn()
            .map_err(|e| format!("Failed to launch installer: {}", e))?;
    }

    #[cfg(not(windows))]
    {
        let _ = open::that(&temp_file);
    }

    // Schedule graceful exit of current process after 1.5s so installer can proceed cleanly
    tokio::spawn(async {
        tokio::time::sleep(tokio::time::Duration::from_millis(1500)).await;
        std::process::exit(0);
    });

    Ok(temp_file)
}

pub fn is_allowed_update_url(url: &str) -> bool {
    let Ok(parsed) = url.parse::<reqwest::Url>() else {
        return false;
    };
    if parsed.host_str() != Some("github.com") {
        return false;
    }
    parsed.path().starts_with("/TheDragonSoft/QuizRadar/releases/download/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version_comparison() {
        assert!(is_version_newer("2.2.0", "2.1.0"));
        assert!(is_version_newer("2.1.1", "2.1.0"));
        assert!(is_version_newer("3.0.0", "2.9.9"));
        assert!(!is_version_newer("2.1.0", "2.1.0"));
        assert!(!is_version_newer("2.0.9", "2.1.0"));
        assert!(!is_version_newer("1.9.9", "2.0.0"));
    }
}
