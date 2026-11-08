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
    requirements: "Windows 10 / 11 · 64-bit",
    notes:
      "Full desktop app with automatic schedule sync, system keyring protection, and verified updates.",
  },
  mac: {
    key: "mac",
    label: "Download for macOS",
    shortLabel: "macOS",
    badge: "Apple Silicon (arm64)",
    primaryArtifact: `QuizRadar_${APP_VERSION}_aarch64.dmg`,
    primaryUrl: `${GITHUB_DOWNLOAD_BASE}/QuizRadar_${APP_VERSION}_aarch64.dmg`,
    requirements: "macOS 13 Ventura or newer · Apple Silicon",
    notes: "Native macOS app with Keychain security, menu bar access, and quiet background sync.",
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
    requirements: "x86_64 · Desktop Linux",
    notes: "Self-contained AppImage or Debian package with native system keyring integration.",
  },
  android: {
    key: "android",
    label: "Download Android APK",
    shortLabel: "Android",
    badge: "Android 8.0+ (arm64 & x86_64)",
    primaryArtifact: `QuizRadar-v${APP_VERSION}.apk`,
    primaryUrl: `${GITHUB_DOWNLOAD_BASE}/QuizRadar-v${APP_VERSION}.apk`,
    requirements: "Android 8.0 or newer",
    notes:
      "Native Android app featuring a 2×1 home-screen countdown widget, exam reminders, and share-sheet quick import.",
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
      "Weekly classes, highlighted exam slots, and auto-scheduled study sessions share one unified timetable — ready for Google Calendar push or .ics export.",
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
      "Open any assessment to check off topics, launch a 25-minute Focus Pomodoro, practice sample questions offline, or project your What-If target grade.",
    darkSrc: "/screenshots/app-detail-dark.webp",
    lightSrc: "/screenshots/app-detail-light.webp",
    alt: "QuizRadar Assessment Detail modal for Class Quiz 2 — CPU Scheduling showing syllabus topic checkboxes, Pomodoro and Practice Quiz buttons, and Grade What-If inputs.",
  },
  {
    id: "conflict",
    tabLabel: "Conflict Radar",
    badge: "Cluster Warning",
    caption:
      "When two exams or major deadlines land within 26 hours, Conflict Radar flags the pileup above your dashboard and carves out dedicated study blocks in one click.",
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
    kicker: "Direct On-Device Check",
    title: "Your professor posts an announcement with a fuzzy date.",
    body: "Announcements rarely include a clean calendar invite. Professors write relative dates across Gmail, Microsoft Teams, Moodle, or Google Classroom — and QuizRadar checks them privately on your device without your passwords leaving your computer.",
    courseCode: "CSE 341",
    courseName: "Operating Systems",
    courseColor: "#8e24aa",
    snippetLabel: "Gmail · Thu, Oct 29",
    snippetText:
      "Class Quiz 2 on CPU Scheduling is moved to next week’s Thursday lecture, not this week.",
    highlight: "next week’s Thursday lecture, not this week",
    resolvedDate: "Relative date recognized (+7d shift)",
    resolvedRoom: "Pending timetable match",
    honestyNote: "Direct inbox scan · Verified privately on your device",
  },
  {
    number: "02",
    id: "cross-reference",
    kicker: "Class Timetable Match",
    title: "Matches the course against your enrolled class schedule.",
    body: "Instead of defaulting to midnight or dropping a vague all-day reminder, QuizRadar looks up your enrolled lecture, tutorial, or lab slot for that exact course and section.",
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
    courseName: "Linear Algebra · Midterm",
    courseColor: "#ea8600",
    snippetLabel: "Microsoft Teams · Room Pending",
    snippetText:
      "Midterm confirmed for the Tuesday after next during tutorial time. Exam hall TBA by registrar.",
    highlight: "the Tuesday after next during tutorial time",
    resolvedDate: "Tue, Nov 10 · 1:00 – 2:30 PM",
    resolvedRoom: "—",
    honestyNote: "Unannounced room stays “—” · Original announcement preserved",
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
    protocol: "Direct & Private",
    summary:
      "Searches course and quiz updates directly on your device. Your emails never leave your computer.",
  },
  {
    id: "teams",
    name: "Microsoft Teams",
    protocol: "Class Channels",
    summary: "Reads class announcements and channel posts to detect date changes and upcoming midterms.",
  },
  {
    id: "moodle",
    name: "Moodle LMS",
    protocol: "Campus Portal",
    summary:
      "Imports quizzes, assignment deadlines, and private calendar feeds directly from your university Moodle.",
  },
  {
    id: "classroom",
    name: "Google Classroom",
    protocol: "Coursework Feed",
    summary:
      "Pulls active coursework deadlines, assignments, and syllabus topics from your enrolled classes.",
  },
  {
    id: "gcal",
    name: "Google Calendar",
    protocol: "One-Way Export",
    summary:
      "Exports confirmed exams to your calendar or downloads standard .ics files — never reads personal events.",
  },
  {
    id: "drive",
    name: "Drive AppData",
    protocol: "Private Backup",
    summary:
      "Optional backup of your courses, topics, and study progress stored safely in your personal Google Drive.",
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
      "Never. QuizRadar has zero backend servers, zero user accounts, and zero telemetry. Your access tokens stay protected inside your device's secure vault (Windows Credential Manager, macOS Keychain, Linux Secret Service, or Android Keystore), and all announcements are processed locally on your machine.",
  },
  {
    question: "Do I need a Gemini API key for QuizRadar to work?",
    answer:
      "No. Every core feature — announcement parsing, timetable matching, conflict detection, study session scheduling, Grade What-If projections, and flashcard quizzes — works 100% offline using built-in rules. Adding an optional AI key is completely up to you.",
  },
  {
    question: "What happens when a professor hasn’t announced the exam room yet?",
    answer:
      "QuizRadar follows a strict Honesty Doctrine: unannounced rooms render as “—”, never a fabricated placeholder, and every anchored date displays the original announcement quote so you can verify the details yourself.",
  },
  {
    question: "Will Google Calendar sync overwrite or read my personal events?",
    answer:
      "No. Calendar export is strictly one-way and requires your explicit action. When you choose to export, QuizRadar only writes the specific study events or exams you confirm, and never reads or touches your personal calendar.",
  },
  {
    question: "How do I move my semester schedule between Desktop, Web, and Android?",
    answer:
      "Use Data & Backup to export an encrypted snapshot file (or use your private Google Drive backup) and open it on your other device. Each device connects to your class sources independently, so your passwords never travel across the internet.",
  },
  {
    question: "What is the difference between the Desktop/Android apps and the Web Companion?",
    answer:
      "All three versions share the exact same core scheduling engine. The Desktop and Android apps add persistent on-device background checks, lock-screen notifications, and the Android home-screen widget, while the Web Companion runs instantly in any modern browser with zero installation.",
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
