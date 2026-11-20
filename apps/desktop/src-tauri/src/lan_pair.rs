//! Ephemeral, on-demand Desktop LAN HTTPS pairing session (`AGENTS.md` §1
//! maintainer override 2026-11-20).
//!
//! Security & privacy invariants:
//! - Never runs at startup or as a background daemon — only started when the
//!   student explicitly clicks "Start Wi-Fi Sync" in Desktop Settings / Cloud Sync.
//! - Generates a fresh per-session self-signed X.509 certificate (SAN = local
//!   LAN IPv4) and pins its 32-byte SHA-256 fingerprint inside the QR code
//!   (`quizradar://lan?h=<ip>&p=<port>&t=<token>&fp=<sha256>&v=1`).
//! - Authenticates `POST /pair` with a single-use 256-bit random bearer token
//!   verified in constant time, and rejects payloads > 32 MB (`REFUSE_TRUNCATE_BYTES`).
//! - Exchanges **data-only `BackupPayload` JSON** (structurally token-free):
//!   merges the phone's payload into Desktop and returns Desktop's newly merged
//!   payload in one round-trip.
//! - Auto-closes immediately after 1 completed bidirectional sync, after 16
//!   rejected auth attempts, after 5 minutes, or when `stop_session` is called.

use std::net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket};
use std::sync::Arc;
use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{Local, Utc};
use quizradar_core::store::backup::{BackupPayload, MergeReport, REFUSE_TRUNCATE_BYTES};
use quizradar_core::store::Store;
use quizradar_core::sync::pair::{build_lan_pair_uri, is_allowed_lan_ipv4};
use quizradar_core::sync::qr::{encode_qr_matrix, QrMatrix};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::{oneshot, Mutex};
use tokio_rustls::TlsAcceptor;

/// Maximum lifetime of an ephemeral LAN pairing session (5 minutes).
pub const LAN_PAIR_SESSION_TTL: Duration = Duration::from_secs(300);

const MAX_HTTP_HEADER_BYTES: usize = 16 * 1024;
const MAX_REJECTED_ATTEMPTS: usize = 16;

/// Session metadata returned to the Desktop UI so it can render the tiny QR code
/// and countdown timer.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanPairSessionInfo {
    pub uri: String,
    pub host: String,
    pub port: u16,
    pub expires_at_iso: String,
    pub ttl_seconds: u64,
    pub qr: QrMatrix,
}

/// Response body returned over TLS from `POST /pair` to the Android peer.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanPairExchangeResponse {
    pub payload: BackupPayload,
    pub merge_report: MergeReport,
}

/// Lifecycle events emitted to the Desktop frontend via Tauri events.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LanPairEvent {
    Completed { merge_report: MergeReport },
    Expired { reason: String },
}

struct ActiveLanSession {
    cancel_tx: Option<oneshot::Sender<()>>,
}

impl Drop for ActiveLanSession {
    fn drop(&mut self) {
        if let Some(tx) = self.cancel_tx.take() {
            let _ = tx.send(());
        }
    }
}

/// Holds at most one active ephemeral LAN pairing session for the Desktop app.
#[derive(Clone, Default)]
pub struct LanPairManager {
    active: Arc<Mutex<Option<ActiveLanSession>>>,
}

impl LanPairManager {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Stops any currently active pairing session immediately.
    pub async fn stop(&self) {
        let mut guard = self.active.lock().await;
        if let Some(mut session) = guard.take() {
            if let Some(tx) = session.cancel_tx.take() {
                let _ = tx.send(());
            }
        }
    }

    /// Starts a new ephemeral LAN HTTPS pairing session on the machine's active
    /// private IPv4 LAN interface. Any previously active session is closed first.
    pub async fn start<F>(&self, store: Store, on_event: F) -> Result<LanPairSessionInfo, String>
    where
        F: Fn(LanPairEvent) + Send + Sync + 'static,
    {
        let host = detect_lan_ipv4().ok_or_else(|| {
            "Could not detect a private Wi-Fi/LAN IPv4 address. Connect Desktop and Android to the same Wi-Fi network or mobile hotspot, or use Offline QR / Sync Link instead.".to_string()
        })?;
        self.start_for_host(store, host, LAN_PAIR_SESSION_TTL, on_event)
            .await
    }

    /// Starts a session advertising `host` (used directly in loopback integration tests).
    pub async fn start_for_host<F>(
        &self,
        store: Store,
        host: Ipv4Addr,
        ttl: Duration,
        on_event: F,
    ) -> Result<LanPairSessionInfo, String>
    where
        F: Fn(LanPairEvent) + Send + Sync + 'static,
    {
        if !is_allowed_lan_ipv4(host) {
            return Err(format!(
                "Refusing to start LAN pairing on non-private address {host}."
            ));
        }

        // Stop any prior session cleanly before opening a new one.
        self.stop().await;

        let token = generate_session_token()?;
        let (cert_der, key_der, fingerprint) = generate_ephemeral_cert(host)?;
        let tls_config = build_tls_server_config(cert_der, key_der)?;
        let acceptor = TlsAcceptor::from(Arc::new(tls_config));

        let bind_ip = if host.is_loopback() {
            IpAddr::V4(Ipv4Addr::LOCALHOST)
        } else {
            IpAddr::V4(Ipv4Addr::UNSPECIFIED)
        };
        let listener = TcpListener::bind(SocketAddr::new(bind_ip, 0))
            .await
            .map_err(|e| format!("Failed to bind ephemeral LAN pairing socket: {e}"))?;
        let port = listener
            .local_addr()
            .map_err(|e| format!("Failed to inspect ephemeral pairing port: {e}"))?
            .port();

        let uri = build_lan_pair_uri(host, port, &token, &fingerprint)?;
        let qr = encode_qr_matrix(&uri)?;
        let expires_at = Utc::now()
            + chrono::Duration::from_std(ttl).unwrap_or_else(|_| chrono::Duration::seconds(300));

        let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
        {
            let mut guard = self.active.lock().await;
            *guard = Some(ActiveLanSession {
                cancel_tx: Some(cancel_tx),
            });
        }

        let active_ref = Arc::clone(&self.active);
        let on_event = Arc::new(on_event);
        tokio::spawn(async move {
            run_pairing_loop(listener, acceptor, store, token, ttl, cancel_rx, on_event).await;
            let mut guard = active_ref.lock().await;
            *guard = None;
        });

        Ok(LanPairSessionInfo {
            uri,
            host: host.to_string(),
            port,
            expires_at_iso: expires_at.to_rfc3339(),
            ttl_seconds: ttl.as_secs(),
            qr,
        })
    }
}

/// Queries the OS routing table via an unbound UDP socket connect (sends zero packets)
/// to find the primary private IPv4 address on the active LAN/Wi-Fi interface.
#[must_use]
pub fn detect_lan_ipv4() -> Option<Ipv4Addr> {
    for probe in [
        "192.0.2.1:80",
        "10.255.255.1:80",
        "172.16.0.1:80",
        "192.168.0.1:80",
    ] {
        if let Ok(sock) = UdpSocket::bind("0.0.0.0:0") {
            if sock.connect(probe).is_ok() {
                if let Ok(SocketAddr::V4(addr)) = sock.local_addr() {
                    let ip = *addr.ip();
                    if ip.is_private() || ip.is_link_local() {
                        return Some(ip);
                    }
                }
            }
        }
    }
    None
}

fn generate_session_token() -> Result<String, String> {
    let mut raw = [0u8; 32];
    getrandom::getrandom(&mut raw)
        .map_err(|e| format!("Failed to generate pairing session entropy: {e}"))?;
    Ok(URL_SAFE_NO_PAD.encode(raw))
}

fn generate_ephemeral_cert(
    host: Ipv4Addr,
) -> Result<(CertificateDer<'static>, PrivateKeyDer<'static>, [u8; 32]), String> {
    let mut params = rcgen::CertificateParams::new(Vec::<String>::new())
        .map_err(|e| format!("Failed to initialize ephemeral TLS params: {e}"))?;
    params.subject_alt_names = vec![rcgen::SanType::IpAddress(IpAddr::V4(host))];
    let key_pair = rcgen::KeyPair::generate()
        .map_err(|e| format!("Failed to generate ephemeral TLS keypair: {e}"))?;
    let cert = params
        .self_signed(&key_pair)
        .map_err(|e| format!("Failed to self-sign ephemeral TLS certificate: {e}"))?;
    let cert_der = cert.der().clone();
    let digest = Sha256::digest(cert_der.as_ref());
    let mut fp = [0u8; 32];
    fp.copy_from_slice(&digest);
    let key_der = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(key_pair.serialize_der()));
    Ok((cert_der, key_der, fp))
}

fn build_tls_server_config(
    cert_der: CertificateDer<'static>,
    key_der: PrivateKeyDer<'static>,
) -> Result<rustls::ServerConfig, String> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    rustls::ServerConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| format!("Failed to configure TLS protocol versions: {e}"))?
        .with_no_client_auth()
        .with_single_cert(vec![cert_der], key_der)
        .map_err(|e| format!("Failed to install ephemeral TLS certificate: {e}"))
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (&x, &y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

enum ConnectionOutcome {
    Synced(MergeReport),
    Rejected,
}

async fn run_pairing_loop<F>(
    listener: TcpListener,
    acceptor: TlsAcceptor,
    store: Store,
    expected_token: String,
    ttl: Duration,
    mut cancel_rx: oneshot::Receiver<()>,
    on_event: Arc<F>,
) where
    F: Fn(LanPairEvent) + Send + Sync + 'static,
{
    let deadline = tokio::time::sleep(ttl);
    tokio::pin!(deadline);
    let mut rejected_attempts = 0usize;

    loop {
        tokio::select! {
            _ = &mut cancel_rx => {
                return;
            }
            _ = &mut deadline => {
                on_event(LanPairEvent::Expired {
                    reason: "Local Wi-Fi sync session timed out after 5 minutes.".to_string(),
                });
                return;
            }
            accepted = listener.accept() => {
                let Ok((tcp_stream, _peer_addr)) = accepted else {
                    continue;
                };
                let outcome = tokio::time::timeout(
                    Duration::from_secs(25),
                    handle_tls_connection(tcp_stream, &acceptor, &store, &expected_token),
                )
                .await
                .unwrap_or(ConnectionOutcome::Rejected);

                match outcome {
                    ConnectionOutcome::Synced(report) => {
                        on_event(LanPairEvent::Completed { merge_report: report });
                        return;
                    }
                    ConnectionOutcome::Rejected => {
                        rejected_attempts += 1;
                        if rejected_attempts >= MAX_REJECTED_ATTEMPTS {
                            on_event(LanPairEvent::Expired {
                                reason: "Local Wi-Fi sync closed after too many invalid attempts.".to_string(),
                            });
                            return;
                        }
                    }
                }
            }
        }
    }
}

async fn handle_tls_connection(
    tcp_stream: tokio::net::TcpStream,
    acceptor: &TlsAcceptor,
    store: &Store,
    expected_token: &str,
) -> ConnectionOutcome {
    let Ok(mut stream) = acceptor.accept(tcp_stream).await else {
        return ConnectionOutcome::Rejected;
    };

    // 1. Read HTTP/1.1 request headers up to \r\n\r\n
    let mut buf = Vec::with_capacity(4096);
    let mut chunk = [0u8; 2048];
    let header_end = loop {
        if let Some(pos) = find_header_end(&buf) {
            break pos;
        }
        if buf.len() >= MAX_HTTP_HEADER_BYTES {
            let _ = write_http_response(
                &mut stream,
                "431 Request Header Fields Too Large",
                b"{\"error\":\"headers too large\"}",
            )
            .await;
            return ConnectionOutcome::Rejected;
        }
        let Ok(n) = stream.read(&mut chunk).await else {
            return ConnectionOutcome::Rejected;
        };
        if n == 0 {
            return ConnectionOutcome::Rejected;
        }
        buf.extend_from_slice(&chunk[..n]);
    };

    let Ok(header_text) = std::str::from_utf8(&buf[..header_end]) else {
        let _ = write_http_response(
            &mut stream,
            "400 Bad Request",
            b"{\"error\":\"invalid headers\"}",
        )
        .await;
        return ConnectionOutcome::Rejected;
    };

    let mut lines = header_text.split("\r\n");
    let request_line = lines.next().unwrap_or_default();
    let mut req_parts = request_line.split_whitespace();
    let method = req_parts.next().unwrap_or_default();
    let path = req_parts.next().unwrap_or_default();
    if method != "POST" || path != "/pair" {
        let _ =
            write_http_response(&mut stream, "404 Not Found", b"{\"error\":\"not found\"}").await;
        return ConnectionOutcome::Rejected;
    }

    let mut auth_header: Option<&str> = None;
    let mut content_length: Option<usize> = None;
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            let name_lower = name.trim().to_ascii_lowercase();
            let val = value.trim();
            if name_lower == "authorization" {
                auth_header = Some(val);
            } else if name_lower == "content-length" {
                content_length = val.parse::<usize>().ok();
            }
        }
    }

    // 2. Verify single-use bearer token in constant time
    let presented_token = auth_header
        .and_then(|h| h.strip_prefix("Bearer "))
        .unwrap_or_default();
    if !constant_time_eq(presented_token.as_bytes(), expected_token.as_bytes()) {
        let _ = write_http_response(
            &mut stream,
            "401 Unauthorized",
            b"{\"error\":\"unauthorized\"}",
        )
        .await;
        return ConnectionOutcome::Rejected;
    }

    let Some(body_len) = content_length else {
        let _ = write_http_response(
            &mut stream,
            "411 Length Required",
            b"{\"error\":\"missing Content-Length\"}",
        )
        .await;
        return ConnectionOutcome::Rejected;
    };
    if body_len > REFUSE_TRUNCATE_BYTES {
        let _ = write_http_response(
            &mut stream,
            "413 Payload Too Large",
            b"{\"error\":\"payload exceeds 32 MB limit\"}",
        )
        .await;
        return ConnectionOutcome::Rejected;
    }

    // 3. Read remaining body bytes
    let body_start = header_end + 4;
    let mut body = Vec::with_capacity(body_len);
    if buf.len() > body_start {
        let already = (buf.len() - body_start).min(body_len);
        body.extend_from_slice(&buf[body_start..body_start + already]);
    }
    while body.len() < body_len {
        let remaining = body_len - body.len();
        let to_read = remaining.min(chunk.len());
        let Ok(n) = stream.read(&mut chunk[..to_read]).await else {
            return ConnectionOutcome::Rejected;
        };
        if n == 0 {
            let _ = write_http_response(
                &mut stream,
                "400 Bad Request",
                b"{\"error\":\"truncated body\"}",
            )
            .await;
            return ConnectionOutcome::Rejected;
        }
        body.extend_from_slice(&chunk[..n]);
    }

    // 4. Parse & merge peer BackupPayload, then return Desktop's newly merged BackupPayload
    let incoming: BackupPayload = match serde_json::from_slice(&body) {
        Ok(p) => p,
        Err(_) => {
            let _ = write_http_response(
                &mut stream,
                "400 Bad Request",
                b"{\"error\":\"invalid BackupPayload JSON\"}",
            )
            .await;
            return ConnectionOutcome::Rejected;
        }
    };

    let now_iso = Utc::now().to_rfc3339();
    let today = Local::now().date_naive();
    let merge_report = match store.merge_backup(incoming, now_iso.clone(), today).await {
        Ok(r) => r,
        Err(e) => {
            let err_body = serde_json::json!({ "error": format!("merge failed: {e}") }).to_string();
            let _ = write_http_response(&mut stream, "400 Bad Request", err_body.as_bytes()).await;
            return ConnectionOutcome::Rejected;
        }
    };

    let desktop_payload = match store
        .build_backup_payload("quizradar-desktop".to_string(), now_iso)
        .await
    {
        Ok(p) => p,
        Err(e) => {
            let err_body =
                serde_json::json!({ "error": format!("export failed: {e}") }).to_string();
            let _ = write_http_response(
                &mut stream,
                "500 Internal Server Error",
                err_body.as_bytes(),
            )
            .await;
            return ConnectionOutcome::Rejected;
        }
    };

    let response = LanPairExchangeResponse {
        payload: desktop_payload,
        merge_report,
    };
    let response_bytes = match serde_json::to_vec(&response) {
        Ok(b) => b,
        Err(_) => return ConnectionOutcome::Rejected,
    };

    if write_http_response(&mut stream, "200 OK", &response_bytes)
        .await
        .is_err()
    {
        return ConnectionOutcome::Rejected;
    }

    ConnectionOutcome::Synced(merge_report)
}

fn find_header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}

async fn write_http_response<W: AsyncWriteExt + Unpin>(
    writer: &mut W,
    status: &str,
    body: &[u8],
) -> std::io::Result<()> {
    let header = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    writer.write_all(header.as_bytes()).await?;
    writer.write_all(body).await?;
    writer.flush().await?;
    let _ = writer.shutdown().await;
    Ok(())
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use quizradar_core::sync::pair::parse_lan_pair_uri;
    use quizradar_core::types::{
        Assessment, AssessmentSource, AssessmentType, Course, ScheduleData,
    };
    use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
    use rustls::pki_types::{ServerName, UnixTime};
    use rustls::{ClientConfig, DigitallySignedStruct, SignatureScheme};
    use std::sync::Mutex as StdMutex;
    use tokio_rustls::TlsConnector;

    #[derive(Debug)]
    struct PinnedSha256Verifier {
        expected_fp: [u8; 32],
    }

    impl ServerCertVerifier for PinnedSha256Verifier {
        fn verify_server_cert(
            &self,
            end_entity: &CertificateDer<'_>,
            _intermediates: &[CertificateDer<'_>],
            _server_name: &ServerName<'_>,
            _ocsp_response: &[u8],
            _now: UnixTime,
        ) -> Result<ServerCertVerified, rustls::Error> {
            let actual = Sha256::digest(end_entity.as_ref());
            if constant_time_eq(actual.as_slice(), &self.expected_fp) {
                Ok(ServerCertVerified::assertion())
            } else {
                Err(rustls::Error::General(
                    "TLS certificate SHA-256 fingerprint mismatch".to_string(),
                ))
            }
        }

        fn verify_tls12_signature(
            &self,
            message: &[u8],
            cert: &CertificateDer<'_>,
            dss: &DigitallySignedStruct,
        ) -> Result<HandshakeSignatureValid, rustls::Error> {
            rustls::crypto::verify_tls12_signature(
                message,
                cert,
                dss,
                &rustls::crypto::ring::default_provider().signature_verification_algorithms,
            )
        }

        fn verify_tls13_signature(
            &self,
            message: &[u8],
            cert: &CertificateDer<'_>,
            dss: &DigitallySignedStruct,
        ) -> Result<HandshakeSignatureValid, rustls::Error> {
            rustls::crypto::verify_tls13_signature(
                message,
                cert,
                dss,
                &rustls::crypto::ring::default_provider().signature_verification_algorithms,
            )
        }

        fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
            rustls::crypto::ring::default_provider()
                .signature_verification_algorithms
                .supported_schemes()
        }
    }

    async fn send_pinned_https_post(
        port: u16,
        expected_fp: [u8; 32],
        token: &str,
        body: &[u8],
    ) -> (String, Vec<u8>) {
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let cfg = ClientConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .unwrap()
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(PinnedSha256Verifier { expected_fp }))
            .with_no_client_auth();
        let connector = TlsConnector::from(Arc::new(cfg));
        let tcp = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .unwrap();
        let server_name = ServerName::IpAddress(IpAddr::V4(Ipv4Addr::LOCALHOST).into());
        let mut tls = connector.connect(server_name, tcp).await.unwrap();
        let req = format!(
            "POST /pair HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        tls.write_all(req.as_bytes()).await.unwrap();
        tls.write_all(body).await.unwrap();
        tls.flush().await.unwrap();

        let mut raw = Vec::new();
        let _ = tls.read_to_end(&mut raw).await;
        let split = find_header_end(&raw).unwrap();
        let status_line = std::str::from_utf8(&raw[..split])
            .unwrap()
            .lines()
            .next()
            .unwrap()
            .to_string();
        (status_line, raw[split + 4..].to_vec())
    }

    #[tokio::test]
    async fn bidirectional_lan_https_sync_rejects_wrong_token_then_merges_and_closes() {
        let desktop_store = Store::open_in_memory().await.unwrap();
        let phone_store = Store::open_in_memory().await.unwrap();

        // Seed Desktop with one course + assessment
        let desktop_schedule = ScheduleData {
            semester: Some("Fall 2026".to_string()),
            academic_week_start: None,
            courses: vec![Course {
                id: "CSE241".to_string(),
                name: "Data Structures".to_string(),
                color: "#1a73e8".to_string(),
                bg: None,
                border: None,
                credits: None,
                max_absences: None,
                aliases: vec![],
            }],
            slots: vec![],
        };
        let ref_date = chrono::NaiveDate::from_ymd_opt(2026, 11, 20).unwrap();
        desktop_store
            .save_schedule(
                desktop_schedule,
                "2026-11-20T10:00:00Z".to_string(),
                ref_date,
            )
            .await
            .unwrap();

        // Seed Phone with a different assessment
        let phone_assessment = Assessment {
            id: "manual-phone-1".to_string(),
            course_id: Some("CSE241".to_string()),
            course_name: Some("Data Structures".to_string()),
            title: "Phone Quiz 1".to_string(),
            assessment_type: AssessmentType::ClassQuiz,
            date: chrono::NaiveDate::from_ymd_opt(2026, 12, 1),
            day_name: None,
            start_time: None,
            end_time: None,
            display_time: None,
            room: None,
            group: None,
            instructor: None,
            is_upcoming: true,
            days_until: None,
            urgency_level: quizradar_core::types::UrgencyLevel::Upcoming,
            priority_score: 50,
            topics: vec!["Trees".to_string()],
            warnings: vec![],
            ai_inference_note: None,
            ai_study_plan: None,
            estimated_study_hours: None,
            elearning_url: None,
            google_cal_url: None,
            gcal_synced: false,
            gcal_event_id: None,
            color: None,
            bg: None,
            border: None,
            semester: None,
            email_subject: None,
            email_sent_date: None,
            source: AssessmentSource::Custom,
            source_icon: None,
            weightage_percent: None,
            achieved_score: None,
            max_score: None,
            conflict_warning: None,
            last_seen_source_run: None,
            retired_source_run: None,
        };
        phone_store
            .upsert_assessment(
                phone_assessment,
                "2026-11-20T11:00:00Z".to_string(),
                ref_date,
            )
            .await
            .unwrap();

        let events: Arc<StdMutex<Vec<LanPairEvent>>> = Arc::new(StdMutex::new(Vec::new()));
        let events_clone = Arc::clone(&events);
        let manager = LanPairManager::new();
        let info = manager
            .start_for_host(
                desktop_store.clone(),
                Ipv4Addr::LOCALHOST,
                Duration::from_secs(30),
                move |ev| {
                    events_clone.lock().unwrap().push(ev);
                },
            )
            .await
            .unwrap();

        let parsed = parse_lan_pair_uri(&info.uri).unwrap();
        let fp_vec = URL_SAFE_NO_PAD
            .decode(parsed.fingerprint_b64url.as_bytes())
            .unwrap();
        let mut expected_fp = [0u8; 32];
        expected_fp.copy_from_slice(&fp_vec);

        let phone_payload = phone_store
            .build_backup_payload(
                "quizradar-android".to_string(),
                "2026-11-20T11:05:00Z".to_string(),
            )
            .await
            .unwrap();
        let phone_body = serde_json::to_vec(&phone_payload).unwrap();

        // 1. Wrong bearer token -> 401 Unauthorized, session stays open for legitimate peer
        let (status_401, _) =
            send_pinned_https_post(parsed.port, expected_fp, "wrong-token", &phone_body).await;
        assert!(status_401.contains("401"), "expected 401, got {status_401}");

        // 2. Valid token + pinned cert -> 200 OK, bidirectional merge completes
        let (status_200, resp_bytes) =
            send_pinned_https_post(parsed.port, expected_fp, &parsed.token, &phone_body).await;
        assert!(status_200.contains("200"), "expected 200, got {status_200}");
        let resp: LanPairExchangeResponse = serde_json::from_slice(&resp_bytes).unwrap();
        assert_eq!(resp.merge_report.assessments_replaced, 1);
        assert_eq!(resp.payload.schedule.courses.len(), 1);
        assert_eq!(resp.payload.assessments.len(), 1);
        assert_eq!(resp.payload.assessments[0].title, "Phone Quiz 1");

        // 3. Listener auto-closed after 1 successful sync
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(
            tokio::net::TcpStream::connect(("127.0.0.1", parsed.port))
                .await
                .is_err(),
            "ephemeral LAN pairing socket must close after 1 completed sync"
        );
        let recorded = events.lock().unwrap();
        assert!(matches!(
            recorded.first(),
            Some(LanPairEvent::Completed { .. })
        ));
    }
}
