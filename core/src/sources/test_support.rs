//! Test-only HTTP-fixture helpers for the source fetchers (compiled under
//! `cfg(test)` only, declared in `sources/mod.rs`). wiremock 0.6 removed
//! `RespondTemplate`, so the echo-id responder lives here.

#![cfg(test)]
#![allow(clippy::unwrap_used, clippy::expect_used)]

use wiremock::{Request, Respond, ResponseTemplate};

/// Responds with a JSON body computed from the incoming request — used where
/// the recorded response must echo a path segment (the Gmail message id).
pub struct JsonResponder(pub Box<dyn Fn(&Request) -> serde_json::Value + Send + Sync>);

impl Respond for JsonResponder {
    fn respond(&self, request: &Request) -> ResponseTemplate {
        ResponseTemplate::new(200).set_body_json((self.0)(request))
    }
}

/// The final path segment of the request URL ("" when absent).
pub fn last_path_segment(request: &Request) -> String {
    request
        .url
        .path()
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .to_string()
}
