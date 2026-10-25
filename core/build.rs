//! Build script for `quizradar-core`.
//!
//! Enforces that `CARGO_PKG_VERSION` matches `tooling/version.json` (the single
//! source of truth across all platforms and shells). Fails fast if a developer or agent
//! updates one without running `node tooling/generate-version.mjs --apply`.

use std::path::Path;

#[allow(clippy::print_stderr)]
fn main() {
    let version_json_path = Path::new("../tooling/version.json");
    if version_json_path.exists() {
        println!("cargo:rerun-if-changed=../tooling/version.json");
        println!("cargo:rerun-if-changed=Cargo.toml");

        if let Ok(content) = std::fs::read_to_string(version_json_path) {
            for line in content.lines() {
                if let Some(idx) = line.find("\"version\"") {
                    let rest = &line[idx + 9..];
                    if let Some(colon) = rest.find(':') {
                        let expected = rest[colon + 1..]
                            .trim()
                            .trim_matches(|c| c == '"' || c == ',' || c == ' ');
                        let current = env!("CARGO_PKG_VERSION");
                        if !expected.is_empty() && current != expected {
                            eprintln!(
                                "quizradar-core CARGO_PKG_VERSION ({current}) does not match tooling/version.json ({expected}). Run `node tooling/generate-version.mjs --apply`."
                            );
                            std::process::exit(1);
                        }
                    }
                }
            }
        }
    }
}
