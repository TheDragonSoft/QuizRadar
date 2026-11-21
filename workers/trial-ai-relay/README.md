# QuizRadar Zero-Key Trial AI Relay (`workers/trial-ai-relay`)

Stateless Cloudflare Worker authorizing first-run Zero-Key Trial AI extractions in QuizRadar (`AGENTS.md` §1 & §3.4 — Maintainer Override 2026-11-21).

## Security & Privacy Guarantees

- **Zero user data storage:** Syllabus PDFs, photos, prompts, courses, assessments, and emails pass strictly through memory and are never logged or written to storage.
- **Zero OAuth tokens:** Any request containing an `Authorization` header is immediately rejected (`400 AUTH_HEADER_FORBIDDEN`).
- **Model & format allowlisted:** Only QuizRadar's structured-JSON Gemini Flash / Flash-Lite models (`responseMimeType: "application/json"`) and payloads up to 16 MB are accepted.
- **Rate limited without PII:** Per-device (`TRIAL_DAILY_LIMIT = 10` calls/UTC day) and per-IP (`TRIAL_IP_DAILY_LIMIT = 30` calls/UTC day) counters store SHA-256 hashes only in `TRIAL_QUOTA_KV` with a 90,000-second auto-expiring TTL.

## Deployment (Cloudflare Workers Free Plan)

From `workers/trial-ai-relay`:

1. Create the KV namespace and copy the printed `id` into `wrangler.toml`:
   ```bash
   npx wrangler kv namespace create TRIAL_QUOTA_KV
   ```
2. Set your Gemini API key as an encrypted Worker Secret (never commit it):
   ```bash
   npx wrangler secret put GEMINI_API_KEY
   ```
3. Deploy the Worker:
   ```bash
   npx wrangler deploy
   ```

Verify health:

```bash
curl https://trial-ai.quizradar.workers.dev/health
```

Clients can override the relay base URL via:

- Desktop / Rust / Android test env: `QUIZRADAR_TRIAL_AI_RELAY_URL`
- Web / PWA Vite env: `VITE_TRIAL_AI_RELAY_URL`
