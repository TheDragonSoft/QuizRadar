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
  shortLabel: string;
  badge: string;
  primaryArtifact: string;
  primaryUrl: string;
  secondaryArtifact?: string;
  secondaryLabel?: string;
  secondaryUrl?: string;
  requirements: string;
  notes: string;
}

export const PLATFORM_DOWNLOADS: Record<PlatformKey, PlatformDownload> = {
  windows: {
    key: "windows",
    label: "Download for Windows",
    shortLabel: "Windows",
    badge: "Windows 10 & 11 (x64)",
    primaryArtifact: `QuizRadar_${APP_VERSION}_x64-setup.exe`,
    primaryUrl: `${GITHUB_DOWNLOAD_BASE}/QuizRadar_${APP_VERSION}_x64-setup.exe`,
    secondaryArtifact: `QuizRadar_${APP_VERSION}_x64-portable.zip`,
    secondaryLabel: "Portable .zip",
    secondaryUrl: `${GITHUB_DOWNLOAD_BASE}/QuizRadar_${APP_VERSION}_x64-portable.zip`,
    requirements: "Windows 10 / 11 · 64-bit WebView2",
    notes:
      "Signed NSIS installer with OS Keyring token storage and minisign-verified in-app updates.",
  },
  mac: {
    key: "mac",
    label: "Download for macOS",
    shortLabel: "macOS",
    badge: "Apple Silicon (arm64)",
    primaryArtifact: `QuizRadar_${APP_VERSION}_aarch64.dmg`,
    primaryUrl: `${GITHUB_DOWNLOAD_BASE}/QuizRadar_${APP_VERSION}_aarch64.dmg`,
    requirements: "macOS 13 Ventura or newer · Apple Silicon",
    notes: "Native Tauri 2 WebKit shell with macOS Keychain token storage and background sync.",
  },
  linux: {
    key: "linux",
    label: "Download for Linux",
    shortLabel: "Linux",
    badge: "AppImage & Debian (.deb)",
    primaryArtifact: `QuizRadar_${APP_VERSION}_amd64.AppImage`,
    primaryUrl: `${GITHUB_DOWNLOAD_BASE}/QuizRadar_${APP_VERSION}_amd64.AppImage`,
    secondaryArtifact: `QuizRadar_${APP_VERSION}_amd64.deb`,
    secondaryLabel: "Debian / Ubuntu (.deb)",
    secondaryUrl: `${GITHUB_DOWNLOAD_BASE}/QuizRadar_${APP_VERSION}_amd64.deb`,
    requirements: "x86_64 · WebKitGTK 4.1 & Secret Service keyring",
    notes: "Portable AppImage or Debian package with libsecret keyring integration.",
  },
  android: {
    key: "android",
    label: "Download Android APK",
    shortLabel: "Android",
    badge: "Android 8.0+ (arm64 & x86_64)",
    primaryArtifact: `QuizRadar-v${APP_VERSION}.apk`,
    primaryUrl: `${GITHUB_DOWNLOAD_BASE}/QuizRadar-v${APP_VERSION}.apk`,
    requirements: "Android 8.0 (API 26) or newer",
    notes:
      "First-party Kotlin + Jetpack Compose M3 app bound to quizradar-core via UniFFI, with a 2×1 Glance countdown widget, T-24h notifications, and Share-Sheet ingest.",
  },
};

export const CHECKSUMS_URL = `${GITHUB_DOWNLOAD_BASE}/SHA256SUMS.txt`;

export interface ProductViewItem {
  id: string;
  tabLabel: string;
  badge: string;
  caption: string;
  darkSrc: string;
  lightSrc: string;
  alt: string;
}

export const PRODUCT_VIEWS: ProductViewItem[] = [
  {
    id: "dashboard",
    tabLabel: "Starry Dashboard",
    badge: "Up next · In 3 days",
    caption:
      "The signature starry Next-Up banner pins the closest quiz from your announcements, paired with 7-day KPIs, ranked study priorities, and per-source filters.",
    darkSrc: "/screenshots/app-dashboard-dark.webp",
    lightSrc: "/screenshots/app-dashboard-light.webp",
    alt: "QuizRadar desktop dashboard showing the starry Next-Up hero for Class Quiz 2 — CPU Scheduling, 7-day KPI cards, What Should I Study priorities, and source filters.",
  },
  {
    id: "calendar",
    tabLabel: "Week Calendar",
    badge: "Exam Glow + Study Blocks",
    caption:
      "Weekly classes, glowing crimson exam slots, and auto-scheduled study sessions share one 8 AM – 8 PM timetable — ready for one-way Google Calendar push or .ics export.",
    darkSrc: "/screenshots/app-calendar-dark.webp",
    lightSrc: "/screenshots/app-calendar-light.webp",
    alt: "QuizRadar week calendar showing colour-coded university lectures, a glowing red Class Quiz 2 slot on Thursday at 10 AM, and scheduled evening study blocks.",
  },
  {
    id: "tasks",
    tabLabel: "Study Roadmap",
    badge: "Per-Exam Readiness",
    caption:
      "Every syllabus topic from your announcements becomes a checkable daily step with live per-course mastery bars and honest hour estimates.",
    darkSrc: "/screenshots/app-tasks-dark.webp",
    lightSrc: "/screenshots/app-tasks-light.webp",
    alt: "QuizRadar Daily Study Roadmap view showing Exam Readiness cards across five courses and today's checkable topic list.",
  },
  {
    id: "detail",
    tabLabel: "Study Plan & What-If",
    badge: "Topics · Pomodoro · Grades",
    caption:
      "Open any assessment to check off topics, launch a 25-minute Focus Pomodoro, generate a local or BYOK practice quiz, or project your What-If course grade.",
    darkSrc: "/screenshots/app-detail-dark.webp",
    lightSrc: "/screenshots/app-detail-light.webp",
    alt: "QuizRadar Assessment Detail modal for Class Quiz 2 — CPU Scheduling showing syllabus topic checkboxes, Pomodoro and Practice Quiz buttons, and Grade What-If inputs.",
  },
  {
    id: "conflict",
    tabLabel: "Conflict Radar",
    badge: "26h Cluster Warning",
    caption:
      "When two exams or major deadlines land within 26 hours, Conflict Radar flags the cluster above your dashboard and carves out free study blocks in one click.",
    darkSrc: "/screenshots/app-conflict-dark.webp",
    lightSrc: "/screenshots/app-conflict-light.webp",
    alt: "QuizRadar Exam Overload and Schedule Conflict banner warning about clustered assessments within 26 hours alongside the Auto-Schedule Study Blocks button.",
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
    kicker: "Direct On-Device Scan",
    title: "Your professor posts a fuzzy date in an email or channel.",
    body: "Announcements rarely include an ISO calendar invite. Professors write relative phrases in Gmail, Microsoft Teams, Moodle, or Google Classroom — and QuizRadar scans them locally on your device via PKCE OAuth.",
    courseCode: "CSE 341",
    courseName: "Operating Systems",
    courseColor: "#8e24aa",
    snippetLabel: "Gmail · Thu, Oct 29",
    snippetText:
      "Class Quiz 2 on CPU Scheduling is moved to next week’s Thursday lecture, not this week.",
    highlight: "next week’s Thursday lecture, not this week",
    resolvedDate: "Relative phrase detected (+7d skip)",
    resolvedRoom: "Pending slot lookup",
    honestyNote: "5 targeted Gmail queries · Deduplicated locally in SQLite",
  },
  {
    number: "02",
    id: "cross-reference",
    kicker: "Timetable Cross-Reference",
    title: "The Rust core matches the course against your weekly class slots.",
    body: "Instead of guessing midnight or dropping an all-day reminder, quizradar-core looks up your enrolled lecture, tutorial, or lab slot for that exact course and section.",
    courseCode: "CSE 341",
    courseName: "Operating Systems · Sec 1",
    courseColor: "#8e24aa",
    snippetLabel: "Enrolled Weekly Slot",
    snippetText: "Thursday Lecture · 10:00 AM – 11:30 AM · CS Lab 3",
    resolvedDate: "Thu, Nov 5 · 10:00 – 10:45 AM",
    resolvedRoom: "CS Lab 3",
    honestyNote: "Exact lecture start time & room inherited from your timetable",
  },
  {
    number: "03",
    id: "honest-radar",
    kicker: "Honest Output & Conflict Check",
    title: "Pinned to your starry radar — with zero fabricated details.",
    body: "If an exam hall hasn’t been announced yet, QuizRadar renders “—” rather than inventing a room. If another quiz lands within 26 hours, Conflict Radar offers to schedule free study blocks.",
    courseCode: "MTH 203",
    courseName: "Linear Algebra · Midterm",
    courseColor: "#ea8600",
    snippetLabel: "Microsoft Teams · Unassigned Hall",
    snippetText:
      "Midterm confirmed for the Tuesday after next during tutorial time. Exam hall TBA by registrar.",
    highlight: "the Tuesday after next during tutorial time",
    resolvedDate: "Tue, Nov 10 · 1:00 – 2:30 PM",
    resolvedRoom: "—",
    honestyNote: "Missing room stays “—” · Inference note preserved verbatim",
  },
];

export interface IngestionSource {
  id: "gmail" | "teams" | "moodle" | "classroom" | "gcal" | "drive";
  name: string;
  protocol: string;
  summary: string;
}

export const INGESTION_SOURCES: IngestionSource[] = [
  {
    id: "gmail",
    name: "Gmail",
    protocol: "PKCE OAuth 2.0",
    summary:
      "Runs targeted course & quiz queries directly on your device with message deduplication.",
  },
  {
    id: "teams",
    name: "Microsoft Teams",
    protocol: "Graph PKCE",
    summary: "Scans enrolled class channel threads and announcements for quiz shifts and midterms.",
  },
  {
    id: "moodle",
    name: "Moodle LMS",
    protocol: "REST Token + .ics",
    summary:
      "Imports quizzes, assignment deadlines, and private calendar feeds from your campus Moodle.",
  },
  {
    id: "classroom",
    name: "Google Classroom",
    protocol: "Coursework API",
    summary:
      "Pulls active coursework deadlines and syllabus topics straight from your enrolled classes.",
  },
  {
    id: "gcal",
    name: "Google Calendar",
    protocol: "One-Way Push",
    summary:
      "Pushes verified exams out to your calendar or exports standard .ics files — never reads personal events.",
  },
  {
    id: "drive",
    name: "Drive AppData",
    protocol: "Secret-Free Backup",
    summary:
      "Optional data-only snapshot of courses, topics, and grades in your private AppData folder.",
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
      "Never. QuizRadar has zero backend servers, zero user accounts, and zero telemetry. Every OAuth token stays in your OS Keyring (Desktop), EncryptedSharedPreferences (Android), or browser tab memory (Web Companion), and announcements are parsed locally on your device.",
  },
  {
    question: "Do I need a Gemini API key for QuizRadar to work?",
    answer:
      "No. Every core feature — fuzzy announcement parsing, timetable anchoring, conflict detection, study block scheduling, Grade What-If projections, and topic-based practice quizzes — works 100% offline using deterministic Rust rules. Adding your own Gemini key (sent via x-goog-api-key) is strictly optional.",
  },
  {
    question: "What happens when a professor hasn’t announced the exam room yet?",
    answer:
      "QuizRadar follows a strict Honesty Doctrine: unannounced rooms render as “—”, never a placeholder string, and every anchored date carries a transparent Focus note showing which phrase and timetable slot produced it.",
  },
  {
    question: "Will Google Calendar sync overwrite or read my personal events?",
    answer:
      "No. Google Calendar sync is explicit-off by default and strictly one-way: when you click Push, QuizRadar writes only the assessments you choose (or exports a standard .ics file) and never imports or inspects your personal calendar.",
  },
  {
    question: "How do I move my semester schedule between Desktop, Web, and Android?",
    answer:
      "Open Data & Backup to export a secret-free JSON snapshot (or use Google Drive AppData on Desktop/Android) and import it on your other device. Each device authenticates its own scanning sources independently so OAuth tokens never cross a network.",
  },
  {
    question: "What is the difference between the Desktop/Android apps and the Web Companion?",
    answer:
      "All three run the exact same quizradar-core Rust engine. Desktop (Tauri 2) and Android (Kotlin + UniFFI) add persistent OS keyring storage, background scanning, T-24h notifications, and the 2×1 Android Glance widget, while the Web Companion runs instantly in any browser via WebAssembly + IndexedDB.",
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
 * Pure client OS detector used to label and route the primary download CTA.
 */
export function detectClientPlatform(userAgent: string, platform = ""): PlatformKey {
  const ua = `${userAgent} ${platform}`.toLowerCase();
  if (ua.includes("android")) return "android";
  if (ua.includes("mac") && !ua.includes("iphone") && !ua.includes("ipad")) return "mac";
  if (ua.includes("linux") && !ua.includes("android")) return "linux";
  return "windows";
}
