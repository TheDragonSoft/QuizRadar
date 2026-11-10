> **ARCHIVED 2026-11-10** — executed/reviewed: the actionable items from this review were landed by
> the landing redesign round (`design/landing-student-clarity`, see `docs/worklog/2026-11.md`).
> Kept as a historical record; remaining items must be re-validated against the current build
> before being treated as open work.

# QuizRadar Website & Web Companion — Comprehensive Improvement Review

> **Date**: November 2026  
> **Target Subsystems**: `apps/landing` (Astro marketing & download site) & `apps/web` (WebAssembly PWA companion at `/app/`)  
> **Purpose**: Detailed technical and UX review for peer agent evaluation, backlog planning, and implementation.

---

## 1. Executive Summary & Review Scope

QuizRadar's newly deployed landing page (`apps/landing`) represents a solid foundation: it is built with **Astro**, adheres strictly to the project's **Honesty Doctrine** (no fabricated rooms or countdowns), features dual-theme 2x Retina product screenshots, and links directly to multi-platform download artifacts and an offline-capable WebAssembly companion (`/app/`).

However, an exhaustive audit across **conversion engineering, mobile usability, technical SEO, installation friction, and interactive demonstration** reveals several critical gaps and high-leverage opportunities:

1. **Critical Technical SEO & Social Sharing Defect**: Missing `og:image` and `twitter:image` tags in `Layout.astro`, causing broken or image-less link unfurls across social platforms (Discord, WhatsApp, X/Twitter, Slack).
2. **Mobile Navigation Blackout**: On viewports under `440px`, the primary navigation pill—including the **Download** link—is completely hidden (`display: none;`), leaving mobile users stranded without navigation controls.
3. **Above-the-Fold UI Latency**: On standard 1080p and laptop viewports, the actual software interface is positioned 100% below the fold due to excessive hero padding, delaying the core visual proof.
4. **Lack of Interactive Demonstration**: The value proposition ("fuzzy announcement → exact timetable slot") is currently told via static text and static screenshots, rather than shown interactively.
5. **Download Friction & OS Warning Abandonment**: First-time users downloading unsigned open-source binaries encounter Windows SmartScreen, macOS Gatekeeper, or Android APK sideloading warnings with no on-page guidance.
6. **Web Companion Cold-Start Barrier**: Visitors testing the web app via "Open Web App — No Install" are met immediately with the empty 3-step Onboarding Wizard, without an option to preview or test sample data first.

---

## 2. Priority Action Matrix

| Priority | Issue / Opportunity | File(s) Affected | Complexity | Expected Impact |
|:---:|---|---|:---:|---|
| 🔴 **P0** | **Add Open Graph & Twitter Social Image** | `apps/landing/src/layouts/Layout.astro`, `apps/landing/public/` | Very Low | Fixes broken social media previews & link unfurls |
| 🔴 **P0** | **Fix Mobile Navigation on Small Screens (<440px)** | `apps/landing/src/components/Navbar.astro` | Low | Restores navigation & download access for mobile users |
| 🟡 **P1** | **Address OS Security Warnings on Download Page** | `apps/landing/src/pages/download.astro` | Low | Prevents download abandonment from SmartScreen/Gatekeeper |
| 🟡 **P1** | **Optimize Above-the-Fold Hero & Product Peek** | `apps/landing/src/pages/index.astro`, `apps/landing/src/styles/global.css` | Medium | Puts real UI in view on laptop screens before scrolling |
| 🟡 **P1** | **Interactive Announcement Resolver Playground** | `apps/landing/src/pages/index.astro` (or new component) | Medium | Provides instant "aha!" moment without installing |
| 🟢 **P2** | **"Why Not Google Calendar / Notion?" Matrix** | `apps/landing/src/pages/index.astro` | Low | Overcomes primary competitor & inertia objections |
| 🟢 **P2** | **Timetable Onboarding Clarity (Vision AI Callout)** | `apps/landing/src/pages/index.astro` | Low | Answers the *"Do I have to manually enter 50 classes?"* objection |
| 🟢 **P2** | **Add `FAQPage` JSON-LD Structured Schema** | `apps/landing/src/layouts/Layout.astro` | Low | Unlocks rich expandable FAQ accordions on Google Search |
| 🔵 **P3** | **"Explore Sample Semester" in Web Companion** | `apps/web/src/components/OnboardingWizardModal.tsx` | Medium | Lets visitors test the PWA with demo data before signing in |
| 🔵 **P3** | **Responsive Screenshot `srcset` (Mobile Bandwidth)** | `apps/landing/src/pages/index.astro` | Medium | Saves cellular bandwidth on small screen devices |

---

## 3. Deep-Dive Analysis & Recommended Specifications

### 3.1. Technical SEO & Social Metadata

#### Issue
In `apps/landing/src/layouts/Layout.astro` (lines 88–96):
```astro
<!-- Open Graph / Twitter -->
<meta property="og:type" content="website" />
<meta property="og:site_name" content="QuizRadar" />
<meta property="og:title" content={title} />
<meta property="og:description" content={description} />
<meta property="og:url" content={canonicalUrl} />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content={title} />
<meta name="twitter:description" content={description} />
```
There is **no** `og:image` and **no** `twitter:image` declared. When shared, Discord, iMessage, WhatsApp, Slack, and X/Twitter will display an unbranded text link without a preview banner.

#### Recommendation
1. Produce or export a 1200×630px social card (`apps/landing/public/og-image.png`) showing:
   - The starry radar canopy background.
   - The official squircle logo and wordmark.
   - The tagline: *"Never miss a quiz hidden in a professor's post. Local-first, zero-server exam radar."*
   - Platform pills: Windows · macOS · Linux · Android · Web.
2. Add the following tags to `Layout.astro`:
   ```astro
   const ogImageUrl = new URL(withBase(base, "/og-image.png"), Astro.site ?? "https://thedragonsoft.github.io").toString();

   <meta property="og:image" content={ogImageUrl} />
   <meta property="og:image:width" content="1200" />
   <meta property="og:image:height" content="630" />
   <meta property="og:image:alt" content="QuizRadar — Local-First Exam Radar & Timetable Resolver" />
   <meta name="twitter:image" content={ogImageUrl} />
   <meta name="twitter:image:alt" content="QuizRadar — Local-First Exam Radar & Timetable Resolver" />
   ```
3. Add `FAQPage` schema to the existing `application/ld+json` script block in `Layout.astro` so search engines can generate rich snippet dropdowns for search queries like *"How does QuizRadar work?"* or *"Is QuizRadar safe for student accounts?"*.

---

### 3.2. Mobile Navigation & Responsiveness

#### Issue
In `apps/landing/src/components/Navbar.astro` (lines 351–355):
```css
@media (max-width: 440px) {
  .nav-pill {
    display: none;
  }
  .nav-wordmark {
    font-size: 0.95rem;
  }
}
```
Because the `Download` button is contained inside `.nav-pill`, any visitor using a phone with a viewport ≤ 440px (which includes iPhone 13/14/15/16, Samsung Galaxy, and Google Pixel) loses access to all navigation and the download link. They only see the logo and a tiny "Web App" button.

#### Recommendation
1. **Short-term fix**: Ensure the `Download` link remains visible on small screens by splitting it out or styling it alongside `.nav-actions`:
   ```html
   <!-- Always keep Download and Web App visible in the mobile header -->
   ```
2. **Complete fix**: Implement a clean, accessible mobile navigation drawer or dropdown toggle:
   - A 36×36px hamburger icon button (`aria-label="Open menu"`, `aria-expanded="false"`).
   - An accessible flyout containing:
     - Section jumps: `#views`, `#how-it-works`, `#sources`, `#android`, `#faq`.
     - Direct Download link to `/download/`.
     - Web Companion link to `/app/`.
     - GitHub repository link.

---

### 3.3. Above-the-Fold & Hero Section Optimization

#### Issue
In `apps/landing/src/pages/index.astro`, the hero sky banner (`.hero-sky-card`) has:
- `padding: 52px 52px 118px;`
- Title, description, download button, web app button, and sub-link.
- The real application view stage (`#views`) starts after the closing tag of `.hero-sky-card`.

On a 1080p laptop display (1920×1080 with 125% OS scaling = 1536×864 viewport height, minus browser tabs and bookmarks bar = ~730px usable height), the user cannot see any part of the real application. The page appears as a purely decorative blue card.

#### Recommendation
1. **Reduce vertical excess**:
   - Adjust `.hero-sky-card` padding to `44px 40px 84px` on desktop (and `32px 24px 64px` on mobile).
   - Reduce `.hero-section` bottom padding from `92px` to `48px`.
2. **Stage Elevation / Peek Effect**:
   - Give `#views` a slight negative margin-top (e.g. `-48px`) or position it so the rounded top toolbar of the product stage peeks into the bottom edge of the hero viewport.
   - Seeing the segmented view switcher (`Starry Dashboard`, `Week Calendar`, `Study Tasks`, `Conflict Alerts`, `Detail & Grades`) immediately signals that a concrete, high-craft tool is right below.

---

### 3.4. Interactive Product Demonstration ("Show, Don't Tell")

#### Issue
The site does a stellar job of describing the timetable anchoring logic in prose and showing static before-and-after text cells (`ANCHOR_STEPS`). However, software adoption increases drastically when students can **experience the mechanism interactively**.

#### Recommendation: "Try the Fuzzy Resolver" Playground
Add an interactive demonstration component directly into the `#how-it-works` section:
1. **Interactive Presets** (3 tabs representing actual student scenarios):
   - **Scenario A (Relative Date In Email)**:  
     *Input*: `"Hey class, Quiz 2 will take place next week during our usual lecture time, not this week."*  
     *Resolution*: `Next Week` → Matches Tuesday `10:00 AM - 11:30 AM` slot for `CSE 341` → **Anchored: Tue, Nov 3 · 10:00 AM**  
     *Status*: `Locked onto Timetable Slot`
   - **Scenario B (Unconfirmed Room / Honesty Doctrine)**:  
     *Input*: `"Makeup midterm scheduled during Wednesday lecture slot in Hall B."*  
     *Resolution*: `Wednesday lecture slot` → Matches `MAT 215` → **Anchored: Wed, Nov 11 · 02:00 PM**  
     *Honesty Note*: `Room 'Hall B' unconfirmed by official timetable → Displayed as '—'`
   - **Scenario C (Back-to-Back Crunch Mitigation)**:  
     *Input*: `"Physics lab quiz moved to Friday 9:00 AM."*  
     *Resolution*: 21 hours after Thursday exam → **Conflict Alert Triggered (<26h gap)**  
     *Auto-Action*: **90-minute evening study block scheduled for Thursday 19:30**
2. **Custom Input Option**:
   - Allow the user to type or modify a message and click "Resolve" to watch simulated regex/char-scanner token highlighting live on the page.

---

### 3.5. Objection Handling: "Why Not Google Calendar or Notion?"

#### Issue
The most common friction point for prospective student users is tool inertia: *"I already use Google Calendar and Notion. Why should I install another app?"*

The current FAQ covers data locality, but the site lacks a high-impact visual comparison highlighting QuizRadar's domain-specific superpowers.

#### Recommendation
Add a concise **"Purpose-Built for University Students"** comparison section:

```markdown
| Feature | Google Calendar | Notion / Todoist | QuizRadar |
|---|:---:|:---:|:---:|
| **Understands Relative Dates** ("next week, not this week") | ❌ Requires manual date calculation | ❌ Requires manual typing | ✅ **On-device relative date resolver** |
| **Weekly Timetable Integration** | ❌ Manual event creation | ❌ Separate database | ✅ **Pins exam into exact class/lab slot** |
| **26-Hour Exam Crunch Alerts** | ❌ Overlaps only | ❌ None | ✅ **Detects back-to-back crunch & carves study blocks** |
| **Target Grade What-If Calculator** | ❌ None | ⚠️ Complex formula setup | ✅ **Real-time score projection built-in** |
| **Privacy & Zero-Server Guarantee** | ⚠️ Big Tech cloud storage | ⚠️ Cloud database | ✅ **100% on-device OS Keyring & SQLite** |
```

---

### 3.6. Timetable Onboarding Clarity (Overcoming Setup Hesitation)

#### Issue
The entire premise of QuizRadar relies on cross-referencing announcements against the student's timetable. A visitor reading the landing page might wonder: *"Will I have to spend an hour manually creating all my recurring lectures and labs?"*

In reality, QuizRadar features **Vision Timetable Import** (uploading a screenshot of the university portal for on-device/BYOK AI extraction) and a fast manual course editor with 8 preset colors.

#### Recommendation
In both the Hero and the "How It Works" section, add a clear 1-sentence reassurance:
> **"Zero-Friction Schedule Setup"**: *Import your weekly schedule in seconds by dropping in a portal screenshot (processed via on-device or BYOK Gemini vision), or configure your recurring lectures in 2 minutes with 8 color swatches.*

---

### 3.7. Download Page (`/download/`) Friction Reduction

#### Issue
Because QuizRadar is an open-source application distributed as direct binary releases (`.exe`, `.dmg`, `.AppImage`, `.apk`) without paid third-party enterprise code signing certificates:
1. **Windows**: Windows SmartScreen may show: *"Windows protected your PC — Microsoft Defender SmartScreen prevented an unrecognized app from starting."*
2. **macOS**: Gatekeeper may show: *"QuizRadar cannot be opened because Apple cannot check it for malicious software."*
3. **Android**: Mobile browsers display: *"File might be harmful. Do you want to download QuizRadar-v5.0.0.apk anyway?"* and prompt for *"Install unknown apps"*.

Non-technical students often assume these standard OS warnings mean the file is corrupted or malicious, leading to immediate abandonment.

#### Recommendation
Add an expandable **"First-Time Installation & Security Guide"** accordion below the download cards on `apps/landing/src/pages/download.astro`:
- **Windows**: *"If Windows SmartScreen appears: Click **More info** → **Run anyway**. All binaries are signed with GitHub Actions checksums."*
- **macOS**: *"If Gatekeeper blocks launch: Right-click `QuizRadar.app` in Applications → Select **Open**, or run `xattr -cr /Applications/QuizRadar.app` in Terminal."*
- **Android**: *"When downloading the APK: Tap **Download anyway** → Open notification → Tap **Settings** → Enable **Allow from this source**."*
- **Verification**: Remind users they can independently verify their binary against the published `SHA256SUMS.txt`.

---

### 3.8. Web Companion (`/app/`) Bridge Experience

#### Issue
The landing page prominently features the CTA: **"Open Web App — No Install"**.
When clicked:
1. The user navigates to `/app/` (the WebAssembly/React SPA).
2. The `OnboardingWizardModal` immediately takes over the screen.
3. The wizard requires entering a rhythm preset, connecting OAuth accounts (Google/Microsoft), or enrolling courses.
4. If the user dismisses the wizard to just look around, every screen is empty (*"No upcoming assessments"*, *"No sources connected"*).

#### Recommendation
1. **"Explore Sample Semester" Button in Onboarding Wizard**:
   - Add a subtle secondary action on Step 1 of the Onboarding Wizard: *"Just browsing? Load sample Fall 2026 semester"*.
   - This populates the temporary in-memory IndexedDB with the sample courses (`CSE 341`, `MAT 215`, `CSE 320`) and sample quizzes, allowing them to test the Starry Dashboard, Week Calendar, and Grade What-If calculator live.
   - An informational banner at the top can state: *"Previewing Sample Semester · Reset database in Settings to configure your own courses."*
2. **Mobile Safari/Chrome PWA Installation Tip**:
   - On mobile browsers accessing `/app/`, display a subtle non-intrusive banner or pill: *"Install as App: Tap Share → Add to Home Screen"*.

---

### 3.9. Asset Delivery & Responsive Screenshots

#### Issue
In `apps/landing/src/pages/index.astro`, each tab panel in `#views` renders full-resolution `2160×1350` WebP images:
- `app-dashboard-dark.webp` (~198 KB)
- `app-dashboard-light.webp` (~210 KB)
- `app-calendar-dark.webp` (~200 KB)
- etc.

While modern desktop connections handle this easily, loading 10 large 2160px desktop screenshots on a mobile phone over a 4G connection uses unnecessary memory and bandwidth.

#### Recommendation
1. Generate 1x (`1080×675`) and 2x (`2160×1350`) variants of each screenshot.
2. Use `<picture>` tags or `srcset`:
   ```html
   <img
     srcset={`${withBase(base, view.darkSrc1x)} 1080w, ${withBase(base, view.darkSrc)} 2160w`}
     sizes="(max-width: 768px) 100vw, 1200px"
     ...
   />
   ```

---

## 4. Implementation Plan for Next Agent

When delegating these enhancements, proceed in the following order:

### Phase 1: High-Priority Fixes (P0)
1. **`apps/landing/src/layouts/Layout.astro`**:
   - Export an SVG/PNG 1200×630 open graph banner to `apps/landing/public/og-image.png`.
   - Wire `og:image`, `og:image:width`, `og:image:height`, `twitter:image`.
   - Add `FAQPage` schema to the existing structured data script.
2. **`apps/landing/src/components/Navbar.astro`**:
   - Revise the `@media (max-width: 440px)` rule so the Download link remains accessible.
   - Implement an accessible mobile menu toggle for tablet/phone viewports.

### Phase 2: Friction Reduction & Conversion (P1)
1. **`apps/landing/src/pages/download.astro`**:
   - Add the expandable "First-Time Installation & OS Warnings" helper guide (Windows SmartScreen, macOS Gatekeeper, Android Unknown Sources).
2. **`apps/landing/src/pages/index.astro` & `apps/landing/src/styles/global.css`**:
   - Adjust `.hero-sky-card` padding and `.hero-section` vertical rhythm so the top of `#views` peeks above the fold on desktop viewports.
3. **`apps/landing/src/pages/index.astro`**:
   - Add the interactive "Try the Fuzzy Resolver" live playground widget into `#how-it-works`.

### Phase 3: Copywriting & Value Polish (P2)
1. **`apps/landing/src/pages/index.astro`**:
   - Add the "Why Not Google Calendar or Notion?" comparison table.
   - Add the "10-Second Timetable Vision Import" callout.

### Phase 4: Web Companion Onboarding Integration (P3)
1. **`apps/web/src/components/OnboardingWizardModal.tsx`**:
   - Add the optional "Load Sample Fall 2026 Preview" link for casual visitors coming from the website.

---

## 5. Verification Checklist

After applying improvements, run the following verification pipeline:
- [ ] `pnpm --filter @quizradar/landing test` (Vitest passes with 0 failures).
- [ ] `pnpm --filter @quizradar/landing build` (Astro build succeeds cleanly).
- [ ] Inspect social unfurls using a local/preview Open Graph debugger or headless test.
- [ ] Verify mobile viewport rendering at `375px`, `390px`, `412px`, and `768px`.
- [ ] Ensure the Honesty Doctrine remains unviolated (no fake server claims, no invented demo data in production builds).
