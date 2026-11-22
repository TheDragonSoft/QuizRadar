import versionManifest from "../../../../tooling/version.json";

export const APP_VERSION: string = versionManifest.version;
export const GITHUB_REPO_URL = "https://github.com/TheDragonSoft/QuizRadar";
export const GITHUB_RELEASES_LATEST = `${GITHUB_REPO_URL}/releases/latest`;
export const GITHUB_RELEASE_TAG_URL = `${GITHUB_REPO_URL}/releases/tag/v${APP_VERSION}`;
export const GITHUB_DOWNLOAD_BASE = `${GITHUB_REPO_URL}/releases/download/v${APP_VERSION}`;

export type PlatformKey = "windows" | "mac" | "linux" | "android";

export interface PlatformDownload {
  key: PlatformKey;
  label: string;
  buttonLabel: string;
  shortLabel: string;
  badge: string;
  primaryArtifact: string;
  primaryUrl: string;
  secondaryArtifact?: string;
  secondaryLabel?: string;
  secondaryUrl?: string;
  requirements: string;
  notes: string;
  securityHint: string;
}

export const PLATFORM_DOWNLOADS: Record<PlatformKey, PlatformDownload> = {
  windows: {
    key: "windows",
    label: "Download for Windows",
    buttonLabel: "Download for Windows (.exe)",
    shortLabel: "Windows",
    badge: "Windows 10 & 11 (x64)",
    primaryArtifact: `QuizRadar_${APP_VERSION}_x64-setup.exe`,
    primaryUrl: `${GITHUB_DOWNLOAD_BASE}/QuizRadar_${APP_VERSION}_x64-setup.exe`,
    secondaryArtifact: `QuizRadar_${APP_VERSION}_x64-portable.zip`,
    secondaryLabel: "Portable .zip",
    secondaryUrl: `${GITHUB_DOWNLOAD_BASE}/QuizRadar_${APP_VERSION}_x64-portable.zip`,
    requirements: "Windows 10 / 11 · 64-bit",
    notes:
      "Native desktop app with automatic background scans, Windows Credential Manager vault, ephemeral local Wi-Fi QR pairing, and instant vector PDF schedule export.",
    securityHint:
      "First-run SmartScreen note: because QuizRadar is free MIT open-source without a paid commercial certificate, click “More info” → “Run anyway” and optionally verify the SHA-256 hash below.",
  },
  mac: {
    key: "mac",
    label: "Download for macOS",
    buttonLabel: "Download for macOS (.dmg)",
    shortLabel: "macOS",
    badge: "Apple Silicon (arm64)",
    primaryArtifact: `QuizRadar_${APP_VERSION}_aarch64.dmg`,
    primaryUrl: `${GITHUB_DOWNLOAD_BASE}/QuizRadar_${APP_VERSION}_aarch64.dmg`,
    requirements: "macOS 13 Ventura or newer · Apple Silicon (Intel Mac runs via Web Companion)",
    notes:
      "Native macOS app with macOS Keychain storage, quiet background schedule sync, local Wi-Fi QR phone pairing, and instant vector PDF schedule export.",
    securityHint:
      "First-run Gatekeeper note: right-click QuizRadar.app in Applications and choose “Open”, or allow it in System Settings → Privacy & Security.",
  },
  linux: {
    key: "linux",
    label: "Download for Linux",
    buttonLabel: "Download for Linux (.AppImage)",
    shortLabel: "Linux",
    badge: "AppImage & Debian (.deb)",
    primaryArtifact: `QuizRadar_${APP_VERSION}_amd64.AppImage`,
    primaryUrl: `${GITHUB_DOWNLOAD_BASE}/QuizRadar_${APP_VERSION}_amd64.AppImage`,
    secondaryArtifact: `QuizRadar_${APP_VERSION}_amd64.deb`,
    secondaryLabel: "Debian / Ubuntu (.deb)",
    secondaryUrl: `${GITHUB_DOWNLOAD_BASE}/QuizRadar_${APP_VERSION}_amd64.deb`,
    requirements: "x86_64 · Desktop Linux",
    notes:
      "Self-contained AppImage or Debian package using your desktop Secret Service keyring, pure-Rust SQLite store, and local Wi-Fi QR pairing.",
    securityHint:
      "Mark the AppImage executable (chmod +x) before running, or install the .deb package via sudo dpkg -i.",
  },
  android: {
    key: "android",
    label: "Download Android APK",
    buttonLabel: "Download Android APK (.apk)",
    shortLabel: "Android",
    badge: "Android 8.0+ (arm64 & x86_64)",
    primaryArtifact: `QuizRadar-v${APP_VERSION}.apk`,
    primaryUrl: `${GITHUB_DOWNLOAD_BASE}/QuizRadar-v${APP_VERSION}.apk`,
    requirements: "Android 8.0 or newer",
    notes:
      "Native Jetpack Compose app featuring 4×2 Today’s Schedule & 2×1 Countdown Glance widgets, T-3h lock-screen exam chronometer, attendance tracker, LAN QR sync, and share-sheet import.",
    securityHint:
      "Direct GitHub APK install: tap “Download anyway”, open the APK, and enable “Allow from this source” for your browser.",
  },
};

export const CHECKSUMS_URL = `${GITHUB_DOWNLOAD_BASE}/SHA256SUMS.txt`;

export interface ResolverScenario {
  id: string;
  tabLabel: string;
  courseCode: string;
  courseName: string;
  courseColor: string;
  sourceLabel: string;
  announcement: string;
  highlight: string;
  timetableMatch: string;
  resolvedTitle: string;
  resolvedDate: string;
  resolvedTime: string;
  resolvedRoom: string;
  signalKind: "anchored" | "tba" | "conflict" | "parity";
  signalLabel: string;
  honestyNote: string;
}

export const RESOLVER_SCENARIOS: ResolverScenario[] = [
  {
    id: "relative-shift",
    tabLabel: "Relative date",
    courseCode: "CSE 341",
    courseName: "Operating Systems",
    courseColor: "#8e24aa",
    sourceLabel: "Gmail · Thu, Oct 29",
    announcement:
      "Class Quiz 2 on CPU Scheduling is moved to next week’s Thursday lecture, not this week.",
    highlight: "next week’s Thursday lecture, not this week",
    timetableMatch: "Matched enrolled slot · Thu Lecture (10:00–11:30)",
    resolvedTitle: "Class Quiz 2 — CPU Scheduling",
    resolvedDate: "Thu, Nov 5",
    resolvedTime: "10:00 – 10:45 AM",
    resolvedRoom: "CS Lab 3",
    signalKind: "anchored",
    signalLabel: "Anchored · +7d shift",
    honestyNote: "Time & room inherited from your enrolled Thursday lecture.",
  },
  {
    id: "room-tba",
    tabLabel: "Room TBA",
    courseCode: "MTH 203",
    courseName: "Linear Algebra II",
    courseColor: "#ea8600",
    sourceLabel: "Microsoft Teams · Mon, Nov 2",
    announcement:
      "Midterm confirmed for Friday afternoon during our tutorial block. Exam hall TBA by registrar.",
    highlight: "Friday afternoon during our tutorial block",
    timetableMatch: "Matched enrolled slot · Fri Tutorial (13:00–14:30)",
    resolvedTitle: "Midterm Exam — Spectral Theory",
    resolvedDate: "Fri, Nov 6",
    resolvedTime: "1:00 – 2:30 PM",
    resolvedRoom: "—",
    signalKind: "tba",
    signalLabel: "Honest TBA",
    honestyNote: "Unannounced room stays “—” — never invented. Original quote preserved.",
  },
  {
    id: "exam-pileup",
    tabLabel: "Exam conflict",
    courseCode: "PHYS 102",
    courseName: "Electromagnetism",
    courseColor: "#0f9d58",
    sourceLabel: "Google Classroom · Mon, Nov 2",
    announcement:
      "Problem Set 4 on Maxwell Equations is due Tuesday at 5:00 PM — same day as your CS301 quiz.",
    highlight: "Tuesday at 5:00 PM",
    timetableMatch: "Conflict Radar · 7h gap after CS301 Class Quiz 1",
    resolvedTitle: "Problem Set 4 — Maxwell Equations",
    resolvedDate: "Tue, Nov 3",
    resolvedTime: "5:00 – 6:00 PM",
    resolvedRoom: "—",
    signalKind: "conflict",
    signalLabel: "Cluster alert · Study block queued",
    honestyNote: "Auto-carves a free 90-min Mon 4:00 PM study block before exam day.",
  },
  {
    id: "week-b-lab",
    tabLabel: "Week A/B lab",
    courseCode: "CHM 210",
    courseName: "Physical Chemistry",
    courseColor: "#00acc1",
    sourceLabel: "Canvas iCal · Week B Parity",
    announcement: "Lab Cohort B calorimetry assessment runs during your Week B Tuesday lab window.",
    highlight: "Week B Tuesday lab window",
    timetableMatch: "ISO Week Parity · Even week (Week B active)",
    resolvedTitle: "Lab Assessment — Calorimetry",
    resolvedDate: "Tue, Nov 10",
    resolvedTime: "2:00 – 4:00 PM",
    resolvedRoom: "Chem Lab 2",
    signalKind: "parity",
    signalLabel: "Week B parity",
    honestyNote: "Bi-weekly lab appears cleanly on Week B and stays hidden on Week A.",
  },
];

export interface ProductViewItem {
  id: string;
  tabLabel: string;
  badge: string;
  caption: string;
  highlights: string[];
  darkSrc: string;
  lightSrc: string;
  amoledSrc: string;
  alt: string;
}

export const PRODUCT_VIEWS: ProductViewItem[] = [
  {
    id: "dashboard",
    tabLabel: "Observatory Dashboard",
    badge: "Up next · In 3 days",
    caption:
      "Pins your closest exam inside the celestial Next-Up canopy alongside 7-day workload metrics, ranked “What Should I Study?” priorities, and live source sync status.",
    highlights: [
      "Direct quote provenance under the Next-Up banner",
      "Per-source filter pills across Gmail, Moodle, Teams, Classroom & Canvas",
    ],
    darkSrc: "/screenshots/app-dashboard-dark.webp",
    lightSrc: "/screenshots/app-dashboard-light.webp",
    amoledSrc: "/screenshots/app-dashboard-amoled.webp",
    alt: "QuizRadar desktop dashboard showing the starry Next-Up hero for Class Quiz 2 — CPU Scheduling, connected sources status, study readiness, and ranked What Should I Study cards.",
  },
  {
    id: "calendar",
    tabLabel: "Week Calendar",
    badge: "Week A/B · Exam Glow",
    caption:
      "Weekly lectures, bi-weekly Week A/B labs, glowing exam slots, and auto-scheduled evening study blocks share one clean grid — ready for Google Calendar push, .ics export, or vector PDF print.",
    highlights: [
      "Week A / Week B alternating timetable toggle built into the header",
      "One-click Print / PDF produces an ink-friendly schedule & cram sheet",
    ],
    darkSrc: "/screenshots/app-calendar-dark.webp",
    lightSrc: "/screenshots/app-calendar-light.webp",
    amoledSrc: "/screenshots/app-calendar-amoled.webp",
    alt: "QuizRadar week calendar displaying colour-coded university classes, Week A/B parity switcher, glowing exam slot, and evening study blocks.",
  },
  {
    id: "tasks",
    tabLabel: "Roadmap & Cushion",
    badge: "Study Cushion Check",
    caption:
      "Turns syllabus topics into a checkable daily study roadmap and compares required preparation hours against real free hours in your timetable — alerting you early when a deficit forms.",
    highlights: [
      "Live per-exam readiness progress bars across all enrolled courses",
      "Honest hour estimates and free-slot cushion math with zero guesswork",
    ],
    darkSrc: "/screenshots/app-tasks-dark.webp",
    lightSrc: "/screenshots/app-tasks-light.webp",
    amoledSrc: "/screenshots/app-tasks-amoled.webp",
    alt: "QuizRadar Daily Study Roadmap view showing Exam Readiness cards across five courses, Study Cushion status, and today’s checkable syllabus topics.",
  },
  {
    id: "grades",
    tabLabel: "Grade Center & GPA",
    badge: "4 International Scales",
    caption:
      "Track earned scores and credit-weighted semester GPA across US 4.0, UK Honours, ECTS European, and Percentage scales — completely local in SQLite with honest handling of ungraded assessments.",
    highlights: [
      "Instant scale switching (4.0, UK Honours, ECTS, Percentage)",
      "Per-course weighted breakdown plus What-If target projections",
    ],
    darkSrc: "/screenshots/app-grades-dark.webp",
    lightSrc: "/screenshots/app-grades-light.webp",
    amoledSrc: "/screenshots/app-grades-amoled.webp",
    alt: "QuizRadar Semester Grade Center and Credit-Weighted GPA view showing semester GPA summary, enrolled credit hours, and per-course grade progress bars.",
  },
  {
    id: "focus",
    tabLabel: "Focus & Flashcards",
    badge: "Leitner 5-Box · Offline",
    caption:
      "Pair 25/5/15 Pomodoro sessions with an offline Leitner 5-box spaced repetition deck, topic-seeded practice quizzes, and a persistent Mistake Bank that remembers missed questions.",
    highlights: [
      "Cards advance from Box 1 to Box 5 on recall — 100% offline",
      "Tracks daily study streaks and focused minutes by course",
    ],
    darkSrc: "/screenshots/app-focus-dark.webp",
    lightSrc: "/screenshots/app-focus-light.webp",
    amoledSrc: "/screenshots/app-focus-amoled.webp",
    alt: "QuizRadar Focus workspace displaying Spaced Repetition Flashcards, Pomodoro timer tabs, Mistake Bank, and personal study streak statistics.",
  },
  {
    id: "conflict",
    tabLabel: "Conflict Radar",
    badge: "Auto-Schedule Blocks",
    caption:
      "Whenever two exams or major deadlines land within 48 hours, Conflict Radar surfaces the pileup above your dashboard and carves out protected 90-minute evening study blocks in one click.",
    highlights: [
      "Separates same-day critical clashes from adjacent-day warnings",
      "Never overlaps existing lectures, labs, or custom events",
    ],
    darkSrc: "/screenshots/app-conflict-dark.webp",
    lightSrc: "/screenshots/app-conflict-light.webp",
    amoledSrc: "/screenshots/app-conflict-amoled.webp",
    alt: "QuizRadar Conflict Radar banner flagging clustered assessments within 26 hours alongside the Auto-Schedule Study Blocks action.",
  },
];

export interface AnchorStep {
  number: string;
  id: string;
  kicker: string;
  title: string;
  body: string;
  courseCode: string;
  courseName: string;
  courseColor: string;
  snippetLabel: string;
  snippetText: string;
  highlight?: string;
  resolvedDate: string;
  resolvedRoom: string;
  honestyNote: string;
}

export const ANCHOR_STEPS: AnchorStep[] = [
  {
    number: "01",
    id: "ingest",
    kicker: "Direct On-Device Check",
    title: "Your professor posts an announcement with a fuzzy date.",
    body: "Announcements rarely include a clean calendar invite. Professors write relative dates across Gmail, Microsoft Teams, Moodle, Google Classroom, or Canvas — and QuizRadar checks them privately on your device.",
    courseCode: "CSE 341",
    courseName: "Operating Systems",
    courseColor: "#8e24aa",
    snippetLabel: "Gmail · Thu, Oct 29",
    snippetText:
      "Class Quiz 2 on CPU Scheduling is moved to next week’s Thursday lecture, not this week.",
    highlight: "next week’s Thursday lecture, not this week",
    resolvedDate: "Relative date recognized (+7d shift)",
    resolvedRoom: "Pending timetable match",
    honestyNote: "Your inbox is scanned locally — nothing leaves this device.",
  },
  {
    number: "02",
    id: "cross-reference",
    kicker: "Class Timetable Match",
    title: "Matches the course against your enrolled class schedule.",
    body: "Instead of defaulting to midnight or dropping a vague all-day reminder, QuizRadar looks up your enrolled lecture, tutorial, or lab slot for that exact course, alias, and week parity.",
    courseCode: "CSE 341",
    courseName: "Operating Systems · Sec 1",
    courseColor: "#8e24aa",
    snippetLabel: "Enrolled Class Slot",
    snippetText: "Thursday Lecture · 10:00 AM – 11:30 AM · CS Lab 3",
    resolvedDate: "Thu, Nov 5 · 10:00 – 10:45 AM",
    resolvedRoom: "CS Lab 3",
    honestyNote: "Exact lecture time & room inherited from your timetable",
  },
  {
    number: "03",
    id: "honest-radar",
    kicker: "Clear Schedule & Honest Details",
    title: "Pinned to your schedule — without guessing missing details.",
    body: "If an exam room hasn’t been announced yet, QuizRadar clearly displays “—” so you always know what is confirmed. When two quizzes land close together, Conflict Radar helps you carve out focused study time.",
    courseCode: "MTH 203",
    courseName: "Linear Algebra II · Midterm",
    courseColor: "#ea8600",
    snippetLabel: "Microsoft Teams · Room Pending",
    snippetText:
      "Midterm confirmed for Friday afternoon during tutorial time. Exam hall TBA by registrar.",
    highlight: "Friday afternoon during tutorial time",
    resolvedDate: "Fri, Nov 6 · 1:00 – 2:30 PM",
    resolvedRoom: "—",
    honestyNote: "Unannounced room stays “—” · Original announcement preserved",
  },
];

export interface IngestionSource {
  id: "gmail" | "teams" | "moodle" | "classroom" | "canvas" | "gcal" | "drive" | "wifi" | "printer";
  name: string;
  protocol: string;
  summary: string;
  direction: "input" | "output";
}

export const INGESTION_SOURCES: IngestionSource[] = [
  {
    id: "gmail",
    name: "Gmail",
    protocol: "Read-Only Inbox",
    summary: "Scans course & quiz emails locally on your device. Zero messages leave your machine.",
    direction: "input",
  },
  {
    id: "teams",
    name: "Microsoft Teams",
    protocol: "Class Channels",
    summary: "Reads class announcements and Outlook updates to spot date shifts and midterms.",
    direction: "input",
  },
  {
    id: "moodle",
    name: "Moodle LMS",
    protocol: "Course Calendar",
    summary: "Imports quizzes, assignment cutoffs, and private campus calendar feeds directly.",
    direction: "input",
  },
  {
    id: "classroom",
    name: "Google Classroom",
    protocol: "Coursework Feed",
    summary: "Pulls active coursework due dates and topics from your enrolled Google classes.",
    direction: "input",
  },
  {
    id: "canvas",
    name: "Canvas & Blackboard",
    protocol: "Built-in iCal Guides",
    summary: "Guided setup for Canvas, Blackboard, and any university HTTPS .ics calendar feed.",
    direction: "input",
  },
  {
    id: "gcal",
    name: "Google Calendar & .ics",
    protocol: "One-Way Export",
    summary: "Pushes confirmed exams & study blocks one-way or exports clean .ics / printable PDF.",
    direction: "output",
  },
  {
    id: "wifi",
    name: "Local Wi-Fi QR Sync",
    protocol: "Encrypted Local Wi-Fi",
    summary: "Pairs Desktop & Android in one QR scan on your Wi-Fi — auto-closes after 1 sync.",
    direction: "output",
  },
  {
    id: "drive",
    name: "Drive AppData & Peer Link",
    protocol: "Data-Only Backup",
    summary:
      "Optional personal Drive snapshot or compressed quizradar://pair link — zero tokens ever.",
    direction: "output",
  },
  {
    id: "printer",
    name: "Printable Timetable & Cram Sheet",
    protocol: "Vector A4 / Letter PDF",
    summary:
      "Exports a clean, ink-friendly weekly schedule and topic checklist directly from your browser or desktop.",
    direction: "output",
  },
];

export interface AndroidScreenTab {
  id: string;
  label: string;
  caption: string;
  darkSrc: string;
  lightSrc: string;
  amoledSrc: string;
  alt: string;
}

export const ANDROID_SCREENS: AndroidScreenTab[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    caption:
      "Starry Next-Up countdown, inline conflict banner, and checkable “What should I study now?” topics.",
    darkSrc: "/screenshots/android-dashboard-dark.webp",
    lightSrc: "/screenshots/android-dashboard-light.webp",
    amoledSrc: "/screenshots/android-dashboard-amoled.webp",
    alt: "QuizRadar native Android Dashboard showing Problem Set 4 Next-Up hero, 1 Exam Conflict alert, and interactive topic checklist.",
  },
  {
    id: "agenda",
    label: "Agenda & Attendance",
    caption:
      "Chronological daily class feed with one-tap Present / Absent attendance tracking and absence warnings.",
    darkSrc: "/screenshots/android-agenda-dark.webp",
    lightSrc: "/screenshots/android-agenda-light.webp",
    amoledSrc: "/screenshots/android-agenda-amoled.webp",
    alt: "QuizRadar Android Calendar Agenda showing Monday classes, study drill, assignment deadline, and tap-to-mark attendance pills.",
  },
  {
    id: "calendar",
    label: "3-Day Grid",
    caption:
      "Switch smoothly between Day Agenda, 3-Day Grid, and full Week views tuned for one-handed phone scanning.",
    darkSrc: "/screenshots/android-calendar-dark.webp",
    lightSrc: "/screenshots/android-calendar-light.webp",
    amoledSrc: "/screenshots/android-calendar-amoled.webp",
    alt: "QuizRadar Android 3-Day timetable grid showing lectures, labs, study drills, and highlighted quiz slots.",
  },
  {
    id: "focus",
    label: "Focus & Flashcards",
    caption:
      "Deep-focus Pomodoro timer paired with offline Leitner flashcards, practice drills, and study streak history.",
    darkSrc: "/screenshots/android-review-dark.webp",
    lightSrc: "/screenshots/android-review-light.webp",
    amoledSrc: "/screenshots/android-review-amoled.webp",
    alt: "QuizRadar Android Focus Review screen showing exam practice selector and Leitner spaced repetition flashcards.",
  },
];

export interface SuiteFeatureItem {
  id: string;
  icon: "clock" | "layers" | "sliders" | "printer" | "keyboard";
  title: string;
  body: string;
  badge?: string;
}

export const SUITE_FEATURES: SuiteFeatureItem[] = [
  {
    id: "cushion",
    icon: "clock",
    title: "Study Cushion & Deficit Math",
    body: "Compares required topic prep hours against the actual free waking hours between your classes and warns you early before a crunch day hits.",
  },
  {
    id: "parity",
    icon: "layers",
    title: "Week A / Week B Alternating Parity",
    body: "Bi-weekly labs and tutorials follow real ISO week parity — showing cleanly in the weeks they run without cluttering alternating weeks.",
  },
  {
    id: "aliases",
    icon: "sliders",
    title: "Multiple Course Aliases & 1-Click Reassign",
    body: "Whether a professor writes CS301, CSE 301, or “Algorithms”, course aliases unify announcements under one course automatically.",
  },
  {
    id: "print",
    icon: "printer",
    title: "Vector-Clean Printable Timetable & Cram Sheet",
    body: "Export a crisp, ink-friendly A4 or US Letter PDF combining your weekly schedule with a checkable topic cram sheet for exam week.",
  },
  {
    id: "shortcuts",
    icon: "keyboard",
    title: "Keyboard-First Desktop Navigation",
    body: "Jump between views, jump to today, add an event, or pause your Pomodoro without leaving the keyboard.",
  },
];

export interface FaqItem {
  question: string;
  answer: string;
}

export const FAQ_ITEMS: FaqItem[] = [
  {
    question: "Does QuizRadar send my emails, grades, or tokens to a server?",
    answer:
      "Never. QuizRadar has zero backend servers, zero user accounts, and zero telemetry. Your OAuth tokens stay locked inside your device’s native secure vault (Windows Credential Manager, macOS Keychain, Linux Secret Service, or Android Keystore), and every announcement is parsed locally on your hardware.",
  },
  {
    question: "Do I need an AI API key for QuizRadar to work?",
    answer:
      "No. Every core capability — fuzzy date parsing, course-alias matching, timetable anchoring, conflict & study cushion detection, multi-scale GPA & Grade What-If projections, Week A/B parity, and Leitner 5-box flashcards — runs 100% offline using built-in deterministic rules. Connecting your own optional Gemini API key in Settings is strictly opt-in.",
  },
  {
    question: "What happens when a professor hasn’t announced the exam room yet?",
    answer:
      "QuizRadar follows a strict Honesty Doctrine: unannounced rooms render as “—”, never a guessed placeholder, and every anchored date keeps the professor’s original announcement quote attached so you can verify it in a glance.",
  },
  {
    question: "Will Google Calendar sync overwrite or read my personal events?",
    answer:
      "No. Calendar export is strictly one-way and user-initiated. QuizRadar only pushes the confirmed exams or study blocks you choose to export, and never reads, alters, or deletes your personal calendar events.",
  },
  {
    question:
      "How do I sync my semester between Desktop, Android, and Web without a cloud account?",
    answer:
      "Open Settings → Sync & Data on your laptop to start an instant Local Wi-Fi HTTPS QR pairing session — scan the QR on Android for a single encrypted two-way merge that auto-closes immediately. You can also use serverless quizradar://pair links, JSON backups, or optional Google Drive AppData. Only schedule data syncs; login tokens never leave each device.",
  },
  {
    question: "What is the difference between Desktop, Android, and the Web Companion?",
    answer:
      "All three run the exact same pure-Rust scheduling core. Desktop (Windows, macOS, Linux) and Android add persistent on-device vaults, automatic background checks, LAN QR sync, lock-screen exam chronometers, and Android Glance home-screen widgets, while the Web Companion runs instantly in any modern browser via WebAssembly with zero installation.",
  },
];

/**
 * Joins a subpath cleanly against Astro's configured `BASE_URL`
 * (works identically whether `BASE_URL` is `/` locally or `/QuizRadar` on GitHub Pages).
 */
export function withBase(baseUrl: string, targetPath: string): string {
  const cleanBase = baseUrl === "/" ? "" : baseUrl.replace(/\/+$/, "");
  const cleanTarget = targetPath.startsWith("/") ? targetPath : `/${targetPath}`;
  return `${cleanBase}${cleanTarget}` || "/";
}

/**
 * Detects iPhone / iPad / iPod clients (including iPadOS desktop-mode Safari where
 * `platform === "MacIntel"` and `maxTouchPoints > 1`) so iOS visitors are routed
 * directly to the Web Companion (PWA) instead of a desktop installer.
 */
export function isIosClient(userAgent: string, platform = "", maxTouchPoints = 0): boolean {
  const ua = `${userAgent} ${platform}`.toLowerCase();
  if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod")) {
    return true;
  }
  if (platform.toLowerCase().includes("mac") && maxTouchPoints > 1) {
    return true;
  }
  return false;
}

/**
 * Pure client OS detector used to label and route the primary download CTA.
 */
export function detectClientPlatform(userAgent: string, platform = ""): PlatformKey {
  const ua = `${userAgent} ${platform}`.toLowerCase();
  if (ua.includes("android")) return "android";
  if (ua.includes("mac") && !ua.includes("iphone") && !ua.includes("ipad")) return "mac";
  if (ua.includes("linux") && !ua.includes("android")) return "linux";
  return "windows";
}
