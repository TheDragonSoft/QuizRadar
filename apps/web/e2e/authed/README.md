# Authenticated UX sweep harness

Drives a real Chromium window against the local QuizRadar web app and records
evidence of every reachable UI/UX surface **while the user is actually signed in**.

## What it is for

An AI agent (or a human reviewer) auditing QuizRadar's interface needs to see
what the product actually looks like when it holds real data: the real
timetable, the real calendar, the real settings screen, the real modal. A
signed-out shell or a mocked fixture shows layout only — it cannot show a
broken empty state, a dishonest toast, an inaccessible control, or a console
error that only fires once an account is connected.

This harness produces that ground truth: signed-in screenshots, a DOM outline,
an accessibility scan, console/page/network errors and the app's own toast
messages for every surface it can reach, written to a folder an agent can read
and cite.

It is a **local, developer-facing tool. It is not a CI gate**, and it never
runs in CI.

**Privacy warning:** screenshots of signed-in surfaces contain your own name
and email address, so the evidence folder is personal data on your machine —
do not commit it (it is gitignored) and do not share it without reviewing it
first.

## Entry point

`apps/web/e2e/authed/run-authed-sweep.mjs` — Node ESM, no build step.

It is wired as:

```json
// apps/web/package.json
"e2e:authed": "node e2e/authed/run-authed-sweep.mjs"

// package.json (repository root)
"e2e:authed": "pnpm --dir apps/web e2e:authed"
```

## Quick start

Run from the repository root (PowerShell-friendly):

```powershell
pnpm e2e:authed                                   # interactive: finish the sign-in in the popups
pnpm e2e:authed -- --skip-signin --headless      # smoke run, no account needed
pnpm e2e:authed -- --teams-client-id <your-id>    # optional: your own Azure app id
pnpm e2e:authed -- --google-client-id <your-id>   # optional: your own Google client id
pnpm e2e:authed -- --surfaces dashboard,calendar  # only two surfaces
```

The interactive run opens a visible Chromium window and two OAuth popups. A
human has to complete them; the harness does not and cannot.

## Prerequisites

- Node >= 20
- pnpm >= 9
- Rust stable with the `wasm32-unknown-unknown` target installed — the harness
  runs the WASM build itself:

  ```powershell
  rustup target add wasm32-unknown-unknown
  ```

- A Playwright Chromium. If the browser is missing:

  ```powershell
  pnpm --dir apps/web exec playwright install chromium
  ```

### Google sign-in

Google's GIS token client checks the **calling page's origin** against the
OAuth client's "Authorized JavaScript origins" list. The client id the web tier
bundles (`apps/web/src/pwadapters/browserSources.ts`) authorizes
`http://127.0.0.1:4317` but **rejects** `http://localhost:4317` with
`Error 400: origin_mismatch` — and the harness has to serve the app from
`localhost`, because Microsoft requires that host (see the matrix below).

So the harness writes a **`localhost`-compatible public Google client id** —
`620389124802-98bn4r9kllknq8l820rts76840l4af7q.apps.googleusercontent.com` — into
the app's own Settings → Integrations → "Advanced Settings & Custom OAuth
Overrides" field (`#settings-google-client-id`) before it clicks "Sign in with
Google". A client id is a public identifier: no secret is involved, and none
is ever asked for. `--google-client-id <id>` overrides it.

The popup must still be completed by a human.

### Microsoft sign-in

The **browser tier ships no Microsoft client id** — the web bundle carries only
Google's public id, so on the web tier you sign in with your own Azure app.

The harness, however, ships with the **desktop shell's bundled public
"Microsoft Graph Command Line Tools" app id**
(`14d82eec-204b-4c2f-b7e8-296a70dab67e`, from
`apps/desktop/src-tauri/src/state.rs`) as its default. Microsoft's v2 endpoint
accepts that id's redirect at `http://localhost:<port>/` exactly, so the
signed-in run needs **no Azure app registration and no client secret**.

If you would rather use your own tenant app, register a **single-page
application** with the redirect URI `http://localhost:4317/` and pass its
Application (client) id:

```powershell
pnpm e2e:authed -- --teams-client-id 00000000-0000-0000-0000-000000000000
```

Measured constraint: Microsoft's redirect must use the host `localhost`
**exactly** — `http://127.0.0.1:4317/` is rejected with `AADSTS50011` — and the
path must be exactly `/`. Any port is allowed.

A client id is a public identifier. The harness never asks for — and has no
use for — a client secret.

## Why the harness serves the app from `localhost`

Measured against the real providers — no account, no credentials, no tokens:

| Provider / client id                                                | `http://127.0.0.1:4317` | `http://localhost:4317`                 |
| ------------------------------------------------------------------- | ----------------------- | --------------------------------------- |
| Google GIS, web tier's bundled client id                            | accepted                | rejected (`Error 400: origin_mismatch`) |
| Google GIS, the `localhost`-compatible client id the harness writes | accepted                | accepted                                |
| Microsoft, the desktop shell's bundled Graph CLI client id          | rejected (AADSTS50011)  | accepted                                |

- **Google GIS, web tier's bundled client id** — its "Authorized JavaScript
  origins" list covers `http://127.0.0.1:4317` only, so Google answers
  `Error 400: origin_mismatch` for `http://localhost:4317`.
- **Google GIS, the `localhost`-compatible client id the harness writes** —
  that registration lists both origins, so Google accepts either one.
- **Microsoft, the desktop shell's bundled Graph CLI client id** — Microsoft
  matches the redirect URI by host, and `AADSTS50011` is what it answers for
  `http://127.0.0.1:4317/`.

**The rule:** Microsoft's redirect must use the host `localhost` with the path
exactly `/` and any port — `http://localhost:4317/` is fine,
`http://127.0.0.1:4317/` is not. Google matches the origin exactly instead,
which is why the harness pairs `localhost` with the `localhost`-compatible
Google client id.

## How it works

1. It checks the base URL. If nothing answers there, it builds the WASM bundle
   and starts Vite itself.
2. It opens a real Chromium window against that URL.
3. It fills the app's own Settings with the two public OAuth client ids it was
   given — the Google id and the Microsoft id, both identifiers, never secrets.
4. It signs in with the user's own Google account (GIS popup) and Microsoft
   account (PKCE popup), optionally grants Microsoft mail/calendar consent, and
   triggers the app's own Sync button.
5. It walks every reachable surface: each view, each modal it can open, a
   dark-theme variant and three narrow-viewport (390x844) variants.

For every surface it captures:

- a full-page screenshot,
- a DOM outline — roles, accessible names, test ids, disabled state and aria
  attributes, **never input values**,
- an axe-core accessibility scan,
- the console errors, page errors and failed requests seen on that surface,
- the app's own toast messages.

Surface ids look like `view:dashboard`, `view:settings-integrations`,
`modal:add-course`, `variant:dark-dashboard`, `variant:mobile-calendar`.

## Command-line flags

All flags are optional.

| Flag                      | Default                                             | Meaning                                                                                                                                            |
| ------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--base-url <url>`        | `http://localhost:4317`                             | app to test                                                                                                                                        |
| `--out <dir>`             | `apps/web/e2e-results/authed/<timestamp>`           | evidence folder; relative paths resolve inside `apps/web`                                                                                          |
| `--headless`              | off                                                 | run Chromium headless (only usable together with `--skip-signin`)                                                                                  |
| `--skip-signin`           | off                                                 | do not sign in; run the sweep against the signed-out app (smoke run)                                                                               |
| `--signin-timeout-ms <n>` | `600000`                                            | how long to wait for each sign-in popup                                                                                                            |
| `--profile <dir>`         | `~/.quizradar/e2e-profile`                          | persistent Chromium profile                                                                                                                        |
| `--grant-scan-access`     | on                                                  | ask Microsoft for the mail + calendar scopes                                                                                                       |
| `--no-grant-scan-access`  | —                                                   | skip that consent step                                                                                                                             |
| `--google-client-id <id>` | the `localhost`-compatible public Google client id  | public Google client id the harness writes into Settings before sign-in; a public id, never a secret                                               |
| `--teams-client-id <id>`  | the desktop shell's bundled public Graph CLI app id | the public Azure app (client) id for Microsoft sign-in; never a secret                                                                             |
| `--surfaces a,b,c`        | all                                                 | limit the surfaces (valid ids: `dashboard`, `tasks`, `calendar`, `focus`, `help`, `settings-account`, `settings-courses`, `settings-integrations`) |

### Exit codes

| Code | Meaning                                                                            |
| ---- | ---------------------------------------------------------------------------------- |
| `0`  | the sweep produced evidence (even if the sign-in failed — the report then says so) |
| `1`  | the harness could not run at all                                                   |
| `2`  | usage error (for example `--headless` without `--skip-signin`)                     |

## Evidence produced

Everything lands inside the gitignored `apps/web/e2e-results/` tree:

```text
<out>/report.json          machine-readable: sign-in statuses, scan outcome,
                           coverage, problems, messages, and an explicit
                           `honesty` array
<out>/summary.md           the same facts in prose
<out>/screenshots/<surface-id>.png
<out>/dom/<surface-id>.json
<out>/axe/<surface-id>.json
<out>/console.txt
```

On disk the surface id's `:` and every other character outside `a-z0-9_-`
become `-`, so the files are `view-dashboard.png`, `modal-add-course.png` and
so on; treat `report.json`'s `coverage.surfaces[].screenshot` field as the
authoritative path for each surface.

Read `report.json` first when automating: it is the source of truth, and its
`honesty` array states what was and was not exercised.

## Safety and privacy

- **It never runs in CI.** The harness refuses to start when the `CI`
  environment variable is set — it needs real accounts.
- **It never writes an access token, a cookie, a client secret, or a URL with a
  query string into the evidence.** Screenshots of signed-in surfaces DO
  contain your own name and email address — the app renders them in the account
  section, the account modal and the dashboard KPI strip, and a raster cannot
  be redacted — so the output folder is personal data on your machine: do not
  commit it (it is gitignored) and do not share it without reviewing it first.
- **The persistent browser profile** (default `~/.quizradar/e2e-profile`) keeps
  the user's own Google/Microsoft session cookies on their machine. Deleting
  that folder signs the harness browser out.
- **The web tier holds the OAuth access token in JavaScript memory for about an
  hour**, so the harness never reloads the page after a sign-in, and the tokens
  are gone when the browser closes.
- **The crawler is deliberately narrow.** It only clicks controls that read like
  open/add/new/create/edit/details/manage/connect/grant/backup/search/schedule/account/profile/more,
  and it refuses anything that reads like
  delete/remove/disconnect/wipe/reset/save/submit/confirm/mark/start/stop/import/export/sync/scan/today/week.
  It types into exactly two fields, ever: the Google client id and the
  Microsoft Azure client id — both public identifiers, never secrets, filled
  once through the app's own Settings form, exactly the value a user would
  paste themselves, and only ever with the values the harness was given
  (`--google-client-id`, `--teams-client-id`). It never clicks inside a
  dialog (except the X that dismisses it), and never starts an OAuth consent
  flow of its own. The Sync step described above is the harness's own explicit
  trigger of the app's own Sync button, not a crawler click.

## What the sweep does NOT prove

1. The sweep exercises the **web tier only**; the desktop Tauri shell was not
   exercised.
2. In the web tier the Sync button only fetches the user's **public `.ics`
   feeds** — the Google and Microsoft tokens were not used to fetch Gmail or
   Outlook mail. The tier that really scans mail is the desktop shell.
3. **Only the surfaces listed in the report were opened.** Everything on the
   blocklist was deliberately not clicked, so those paths are **UNVERIFIED**,
   not verified-good.

## Troubleshooting

**The popup was blocked.** Allow popups for the local dev origin
(`http://localhost:4317`) in the browser and re-run.

**The popup was closed before completing.** The sign-in timed out or was
dismissed. The sweep still produces evidence and `report.json` records the
failed sign-in. Re-run and finish the popup; raise the wait with
`--signin-timeout-ms <n>` if the account is slow (default `600000`).

**`needs-teams-client-id`.** The web tier has no Microsoft client id of its
own. The harness normally fills the field with its default — the desktop
shell's bundled public Graph CLI app id — but an explicitly empty
`--teams-client-id` means "no client id". In that case register an Azure
single-page application with a redirect URI of `http://localhost:4317/` (the
host must be exactly `localhost`) and pass the Application (client) id via
`--teams-client-id`. No secret is required or accepted.

**A headless run cannot sign in.** Expected. `--headless` is only usable
together with `--skip-signin`; use `--skip-signin --headless` for a smoke run,
or drop `--headless` for the interactive signed-in sweep.

**The sweep finished with a partially empty surface list.** That is normal. It
means the control was on the blocklist or the surface was unreachable. Check
`report.json` for the surfaces that were opened and treat everything absent
from it as unverified.

**Where is my evidence?** Under the `--out` directory, by default
`apps/web/e2e-results/authed/<timestamp>/`. The same path is printed at the
end of the run and written into `report.json`.
