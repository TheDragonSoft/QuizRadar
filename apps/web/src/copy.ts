/**
 * Single source of truth for user-facing strings across QuizRadar web & desktop.
 * Enforces honesty doctrine copy and prepares the app for i18n without hardcoded literals.
 */

export const copy = {
  brand: {
    name: "QuizRadar",
    home: "QuizRadar — go to dashboard",
    tagline:
      "Never miss a quiz, lab assessment, or midterm buried in your university inbox, Microsoft Teams, Moodle, or Google Classroom.",
  },

  nav: {
    dashboard: "Dashboard",
    tasks: "Tasks",
    calendar: "Calendar",
    focus: "Focus",
    help: "Help & Tiers",
  },

  topBar: {
    searchPlaceholder: "Search assessments, courses, tasks... (/)",
    searchAriaLabel: "Global search",
    searchShortcut: "/",
    syncIdle: "Sync",
    syncScanning: "Scanning…",
    syncSynced: "Synced",
    syncSyncedSummary: (added: number, updated: number) =>
      `Synced · ${added} new, ${updated} updated`,
    syncFailed: "Sync Failed",
    syncCanceled: "Scan canceled - your data was left untouched.",
    themeLight: "Switch to light mode",
    themeDark: "Switch to dark mode",
    themeToggleAria: "Toggle light or dark theme",
    sidebarToggleAria: "Toggle sidebar",
    userSignIn: "Sign in",
    settings: "Settings",
    settingsAria: "Open settings",
    updateAvailable: "Update Available",
    updateNotesFallback: "A new update is ready to install.",
    skipUpdate: "Skip this version",
    // The installer is wired (desktop `download_and_install_update`), so the
    // button really downloads and hands over to the installer. The old
    // "Update on next launch" promised something that never happened.
    updateInstall: "Install update",
    updateInstalling: "Downloading update…",
    updateProgress: (label: string) => `Downloading ${label}`,
    updateInstalled: "Update downloaded — the installer takes over from here.",
    updateFailed: (reason: string) => `Update failed: ${reason}`,
    viewSwitcherLabel: "Switch view",
    dataBackup: "Data & Backup",
    dataBackupTitle: "On-device engine & local data backup",
  },

  sidebar: {
    miniCalendarTitle: "Mini Calendar",
    createEvent: "Create Study Event",
    // The panel lists every kind in the selected week (quizzes, exams, labs,
    // assignments) — the v4 "Exams in Selected Week" title mislabeled them.
    // The title must not say "this week": the mini-calendar's arrows move the
    // panel to any week, so the exact range is printed underneath it.
    weekExamsTitle: "Week's Assessments",
    weekExamsRange: (start: string, end: string) => `${start} – ${end}`,
    weekExamsEmpty: "Nothing scheduled that week.",
    myCalendars: "My calendars",
    showAll: "Show all",
    roomLabel: "Room",
    pushGcal: "Push GCal",
    onDeviceEngine: "On-Device Engine",
    onDeviceStandalone: "100% Standalone",
    onDeviceEngineBody: "Autonomous academic engine running locally in device sandbox.",
    coursesHeader: "Courses",
    noCoursesEnrolled: "No courses enrolled",
    layersHeader: "Layers",
    layerExams: "Quizzes & Exams",
    layerClasses: "Weekly Class Schedule",
    syncFooter: {
      noSources: "No sources connected",
      onDeviceNoSources: "On-Device Engine · No live sources",
      signedInAutoOff: "Signed in · Auto-scan off",
      radarActive: (count: number) => `Radar Active · ${count} source${count === 1 ? "" : "s"}`,
      lastSynced: (time: string) => `Last synced: ${time}`,
      neverSynced: "Never synced",
      syncNow: "Sync now",
    },
  },

  emptyStates: {
    dashboardNoCourses: "Add your first course to populate your timetable and exam radar.",
    dashboardAddCourseAction: "Add Course",
    noAssessmentsFound: "No assessments found yet. Connect your sources or add an assessment.",
    noStudyTasksPending: "No pending study tasks. Mastered all topics or no upcoming exams.",
    noUpcomingExams: "No upcoming exams to prepare for yet.",
    noCalendarItems: "No classes or exams scheduled for this week.",
    noFocusTaskSelected: "Select an assessment or task to begin your focus session.",
  },

  urgency: {
    today: "TODAY",
    tomorrow: "TOMORROW",
    inDays: (days: number) => `IN ${days} DAYS`,
    past: "PAST",
  },

  common: {
    close: "Close",
    cancel: "Cancel",
    confirm: "Confirm",
    save: "Save",
    delete: "Delete",
    edit: "Edit",
    back: "Back",
    retry: "Retry",
    offlineNotice: "Offline mode · Using cached state",
    dayRolloverNotice: "Day rolled over — recomputing study schedule and deadlines",
    /**
     * Shown wherever a readiness bar would otherwise render a percentage for
     * an assessment that has no tracked topics. The core's 0/0 = 100 means
     * "nothing is pending", not "100% mastered" — so the number is withheld.
     * "Syllabus" matters: the planner's generic review steps are NOT
     * syllabus topics the source ever stated.
     */
    noTopicsTracked: "No syllabus topics tracked",
  },

  pullToRefresh: {
    pulling: "Pull to refresh",
    release: "Release to scan sources",
    syncing: "Scanning sources…",
  },

  scan: {
    scanComplete: "Scan complete",
    scanCanceledTitle: "Scan canceled",
    scanFailedTitle: "Scan failed",
    scanSummary: (added: number, updated: number) =>
      `${added} new, ${updated} updated - ${copy.topBar.syncSynced.toLowerCase()}`,
    sourcesRunning: (count: number) =>
      count === 1 ? "1 source reported" : `${count} sources reported`,
    waitingForSources: "Waiting for the first source…",
    noItemsYet: "No items yet",
    noScanRunning: "No scan is running.",
    cancelKeepsData:
      "The scan was aborted before anything was written. Your radar is exactly as it was.",
  },

  dashboard: {
    heroUpNext: (label: string) => `Up next · ${label}`,
    heroToday: "Today",
    heroTomorrow: "Tomorrow",
    heroInDays: (days: number) => `In ${days} days`,
    heroEmptyTitle: "No Upcoming Quizzes Scheduled",
    heroEmptyBody:
      "Connect your University Account or Google Account, or tap Sync Radar to discover your courses and upcoming exams.",
    heroStudyPlan: "Study Plan",
    heroCalendar: "Calendar",
    heroGoogleCal: "Google Cal",
    heroFocusLabel: "Focus:",
    heroConnectAccount: "Connect Account",
    heroSyncRadar: "Sync Radar",
    // The window is "today through +7 days" (the core's `days_until` 0..=7,
    // v4 parity) - it is NOT a calendar week, so the title must not say
    // "this week". The exact date range is printed underneath.
    kpiUpcomingTitle: "Next 7 days",
    kpiUpcomingCountLabel: "Assessments",
    kpiUpcomingEmpty: "Nothing scheduled in the next 7 days",
    // Replaced the "Types of exams" pill breakdown — the count of upcoming
    // midterm/final exams is the number people actually need at a glance.
    kpiExamsTitle: "Exams ahead",
    kpiExamsSubtitle: "Midterm & final exams",
    kpiExamsEmpty: "No upcoming exams",
    kpiReadinessTitle: "Study readiness",
    kpiReadinessSubtext: "Mastery across all upcoming assessments",
    kpiReadinessCounts: (done: number, total: number) =>
      `${done} of ${total} topic${total === 1 ? "" : "s"} mastered`,
    kpiReadinessNone: "No study topics tracked yet",
    kpiSyncTitle: "Gemini & Calendar sync",
    kpiSyncActive: (count: number) => `${count} source${count === 1 ? "" : "s"} active`,
    kpiSyncNone: "No sources connected",
    kpiTypeBreakdown: "By type",
    kpiSyncBadgeActive: "Active",
    kpiSyncBadgeInactive: "Not connected",
    kpiNotConnected: "Not Connected",
    kpiAiActive: "Schedule-aware AI active",
    kpiAiOff: "Schedule-aware AI off",
    kpiSyncCalendarAction: "Sync Calendar",

    subtabs: {
      study: "Study Priority",
      assessments: "Assessments",
      overview: "At a Glance",
    },

    conflictBanner: {
      unresolvedTitle: (count: number) =>
        `Exam Overload & Schedule Conflict Detected (${count} conflict${count > 1 ? "s" : ""})`,
      autoScheduleAction: "Auto-Schedule Study Blocks",
      mitigatedTitle: (count: number) =>
        `Exam Overload Mitigated (${count} Active Study Preparation Blocks)`,
      mitigatedBadge: "Protected",
      mitigatedBody: (count: number) =>
        `All ${count} exam cluster${count > 1 ? "s have" : " has"} dedicated 90-minute preparation blocks booked in your timetable to distribute your study load and prevent last-minute cramming.`,
      partiallyMitigatedNote: (count: number) =>
        `${count} other conflict${count > 1 ? "s" : ""} already ${count > 1 ? "have" : "has"} study blocks booked.`,
      viewOnCalendarAction: "View Blocks on Week Calendar",
      dismissTitle: "Dismiss banner",
      // The auto-schedule outcome is reported by what actually happened - the
      // old toast claimed success even when no block was written.
      blocksCreated: (count: number) =>
        `Added ${count} study block${count === 1 ? "" : "s"} to your timetable`,
      blocksSkippedUndated: (count: number) =>
        `Skipped ${count} assessment${count === 1 ? "" : "s"} without a confirmed date — no study block was added`,
      blocksNoWindow:
        "No free 90-minute study window was found in your timetable — no study block was added",
    },

    recommendationsTitle: "What Should I Study?",
    recommendationsEmpty: "No active study recommendations. You're all caught up!",
    studyEmptyTitle: "Add your first course to build your study plan",
    studyEmptyBody:
      "QuizRadar turns your weekly timetable and announcements into deadline countdowns and a “what should I study” plan.",
    studyEmptyAddCourse: "Add Course",
    studyAllClearTitle: "All Clear for Now!",
    studyAllClearBody:
      "No pending study plans or overdue quizzes. You're completely up to date with your academic radar!",
    studyAddCustomEvent: "Add Custom Quiz or Exam",
    connectAccount: "Connect Account",
    scrollBadge: "Scroll",
    detailsAction: "Details",
    topicsCount: (count: number) => `${count} topic${count === 1 ? "" : "s"}`,
    rulesCount: (count: number) => `${count} rule${count === 1 ? "" : "s"}`,
    scheduleAt: "@",
    topicsCompletedProgress: (done: number, total: number) => `${done}/${total} topics`,
    kpiWeekRange: (start: string, end: string) => `${start} – ${end}`,
    countdownShort: (days: number) => `In ${days}d`,
    roomPrefix: "Room",
    roomLabel: (room: string) => `Room ${room}`,
    scheduleScheduled: "Scheduled",
    /** Timeline chip when an assessment has no course on the timetable. */
    assessmentCourseFallback: "EXAM",
    conflictBadge: "Conflict",
    syllabusTopics: "Syllabus Topics",
    dueAt: (time: string) => `Due ${time}`,

    timelineTitle: "All Assessments",
    timelineSubtitle: "Filter by assessment type or browse across all course records.",
    timelineEmptyTitle: "No assessments scheduled",
    timelineEmptyBody: "Add your courses or connect an account to see quizzes and deadlines here.",
    timelineEmptyFilteredTitle: "No assessments match the current filters",
    timelineEmptyFilteredBody:
      "Your assessments are still here — loosen the type or source filter to see them.",
    timelineClearFilters: "Clear Filters",
    // The top-bar search filters the dashboard lists live (spec §4.8). When it
    // matches nothing the copy must say "nothing matched", never "you are all
    // caught up" - the user is not caught up, the filter hid everything.
    searchFilterActive: (query: string) => `Showing matches for “${query}”`,
    searchClear: "Clear Search",
    timelineEmptySearchTitle: "No assessments match your search",
    timelineEmptySearchBody: (query: string) =>
      `Nothing in your radar matches “${query}”. Clear the search to see every assessment.`,
    studyEmptySearchTitle: "No study plans match your search",
    studyEmptySearchBody: (query: string) =>
      `Nothing in your study plan matches “${query}”. Clear the search to see every plan.`,
    filterAll: "All",
    filterAllSources: "All Sources",
    filterUpcomingOnly: "All Upcoming",
    typeFilterUpcoming: "Upcoming Only",
    typeFilterAll: "All Semesters (Upcoming + Past)",
    typeFilterClassQuiz: "Class Quizzes",
    typeFilterOnlineQuiz: "Online Quizzes",
    typeFilterMidterm: "Midterm Exams",
    typeFilterFinalExam: "Final Exams",
    typeFilterLabAssessment: "Lab Assessments",
    typeFilterAssignment: "Assignments",
    sourcePillGmail: "Gmail",
    sourcePillMoodle: "Moodle",
    sourcePillTeams: "Teams",
    sourcePillClassroom: "Classroom",
    sourcePillManual: "Manual",
    sourcePillFeed: "Feeds",
  },

  tasks: {
    // "study steps", not "topics": when an announcement named no syllabus
    // topics the planner still schedules generic review steps, and calling
    // those topics would contradict the readiness card right below.
    summaryLine: (pending: number, upcoming: number, hours: number | null) =>
      hours !== null
        ? `${pending} pending study steps across ${upcoming} upcoming exams • Est. ${hours} hrs`
        : `${pending} pending study steps across ${upcoming} upcoming exams`,
    filterAllCourses: "All Courses",
    readinessTitle: "Exam Readiness",
    avgBadge: "avg readiness",
    roadmapTitle: "Daily Study Roadmap",
    todayBadge: "Today",
    prepDay: (day: number, total: number) => `Prep day ${day} of ${total}`,
    estHours: (hrs: number) => `${hrs} hr${hrs === 1 ? "" : "s"}`,
  },

  calendar: {
    today: "Today",
    prevWeek: "Previous week",
    nextWeek: "Next week",
    jumpToToday: "Jump to Today",
    legendExam: "Exam / Quiz",
    legendClass: "Class Slot",
    legendCustom: "Custom / Study Block",
    exportAllIcs: "Export all (.ics)",
    timeGutterAria: "Time of day",
    daysHeaderAria: "Week days",
  },

  cloudSync: {
    title: "Cloud Backup & Transfer",
    pushSucceeded: "Data-only cloud backup uploaded to Google Drive AppData",
    pushFailed: (reason: string) => `Cloud backup push failed: ${reason}`,
    pullFailed: (reason: string) => `Cloud backup pull failed: ${reason}`,
    noCloudBackup: "No cloud backup file found in Google Drive AppData",
    mergedUnknown: "Cloud backup merged (the merge report was not returned)",
    mergedSummary: (
      assessments: number,
      topics: number,
      grades: number,
      events: number,
      schedule: boolean,
    ) =>
      `Cloud backup merged: ${assessments} assessment${assessments === 1 ? "" : "s"} replaced, ${topics} topic record${topics === 1 ? "" : "s"} merged, ${grades} grade${grades === 1 ? "" : "s"} merged, ${events} event${events === 1 ? "" : "s"} upserted${schedule ? ", timetable replaced" : ""}`,
  },

  assessmentDetail: {
    title: "Assessment Detail",
    defaultSource: "Gmail Ingestion",
    dateLabel: "Date & Time",
    roomLabel: "Room / Location",
    instructorLabel: "Instructor",
    missingValue: "—",
    topicsHeader: "Syllabus Topics",
    topicsProgress: (done: number, total: number) => `${done} of ${total} topics completed`,
    pomodoroAction: "Start Focus Pomodoro",
    warningsHeader: "Warnings & Alerts",
    examOverloadWarning:
      "⚠️ EXAM OVERLOAD: Another assessment is scheduled within 36 hours of this exam!",
    studyStrategyHeader: "Study Strategy & Guidance",
    aiGuidanceFallback: "Analyzed from course schedule and academic syllabus.",
    elearningLink: "Open in University E-Learning Portal",
    actionsHeader: "Integrations & Export",
    addToGcal: "Add to Google Calendar",
    addedToGcal: "Synced to Google Calendar",
    exportIcs: "Export .ics Calendar File",
    gradeEditorHeader: "Grade Recording & What-If",
    achievedScoreLabel: "Achieved Score",
    maxScoreLabel: "Max Score",
    weightageLabel: "Weightage (%)",
    saveGradeAction: "Save Grade",
    recordedStatus: (score: number, max: number, weight?: number | null) =>
      weight != null ? `Recorded: ${score}/${max} (${weight}%)` : `Recorded: ${score}/${max}`,
    notGradedStatus: "Not Graded",
    whatIfHeader: "Grade Projection & What-If",
    whatIfScoreInputLabel: "Planned score on this assessment (%):",
    whatIfResult: (avg: number) => `→ avg ${avg}%`,
    whatIfFirstItem: "First graded item in this course.",
    whatIfEqualWeight: (count: number) => `Equal-weight average of ${count} graded items.`,
    whatIfNote: "(honest equal-weight average projection across recorded grades)",
  },

  onboarding: {
    title: "Welcome to QuizRadar",
    subtitle:
      "Resolve fuzzy announcements into exact dates by cross-referencing your weekly timetable.",
    step1Title: "Profile & Rhythm",
    step2Title: "Connect Sources",
    step3Title: "Courses & Sync",
    nameLabel: "Your Name",
    emailLabel: "University / Personal Email",
    localProfileNote: "Local profile anchor · We never claim fake authentication",
    tracksTitle: "Academic Rhythm Preset",
    trackMed: "Medicine & Health Sciences",
    trackMedSub: "High-density continuous assessments, clinical rotations",
    trackEng: "Engineering & Sciences",
    trackEngSub: "Lab assessments, problem sets, bi-weekly quizzes",
    trackBiz: "Business & Humanities",
    trackBizSub: "Case studies, midterms, group project milestones",
    trackNotSet: "Not set",
    trackUnknown: "Unknown preset",
    trackSaved: "Academic rhythm saved",
    trackSaveFailed: "Could not save the academic rhythm",
    themeTitle: "Visual Theme",
    themeLight: "Light Theme",
    themeDark: "Dark Theme",
    googleConnect: "Connect Google (Gmail & Calendar)",
    microsoftConnect: "Connect Microsoft Teams",
    moodleConnect: "Connect Moodle LMS",
    moodleUrlLabel: "Moodle Web Portal URL",
    moodleIcalLabel: "Moodle Personal iCalendar URL (recommended)",
    classroomConnect: "Google Classroom Coursework",
    geminiConnect: "Bring Your Own Gemini API Key (Optional)",
    autoGcalLabel: "Automatically push new assessments to Google Calendar (consents first)",
    timetableUpload: "Upload Timetable Image / Screenshot",
    timetableUploadSub:
      "Extract your courses and class slots automatically via Gemini Vision, or enter manually.",
    timetableUploadButton: "Select Timetable Image",
    timetableUploadManual: "Skip / Enter Courses Manually",
    timetableExtracting: "Analyzing timetable with Gemini Vision…",
    connectedBadge: "Connected",
    notConnectedBadge: "Not Connected",
    next: "Next Step",
    back: "Previous Step",
    finish: "Finish & Scan All Sources",
    finishSubmitting: "Setting up and running first scan…",
  },

  ai: {
    disclosure:
      "Your email announcements and timetable images are sent to Google's Gemini API when AI is used. On Google's free tier, Google may use that content to improve its products.",
    turnOff: "Turn off to stay fully local.",
    quotaText: (count: number | null) =>
      count === null
        ? "AI calls today: not tracked on this tier"
        : `AI calls today: ${count} (resets midnight PT)`,
    quotaTextSession: (count: number) =>
      `AI calls this session: ${count} (browser tier counts in memory — it resets on reload)`,
    quotaCapNote: "Free tier quota resets every day at midnight Pacific Time (PT).",
    quotaLimitNote:
      "Google sets the free-tier daily limit per project — see your project in AI Studio.",
    keyPlaceholder: "Paste AI Studio API key (AIzaSy… or AQ…)",
    validateButton: "Validate Key",
    keyValid: "Key validated & stored in OS Keyring",
    keyValidMemory: "Key validated — held in memory for this session only (web tier)",
    keyInvalid: "Invalid API key",
    aiEnabledLabel:
      "Enable Gemini AI features (Timetable Vision, Task Optimization, Practice Quizzes)",
    sharedKeyHint:
      "Shared key for a private install: set QUIZRADAR_GEMINI_API_KEY, or place a gemini.key file next to the app. A key pasted here always wins.",
  },

  settings: {
    title: "Settings",
    tabAccount: "Account",
    tabCourses: "Courses",
    tabIntegrations: "Integrations",
    accountHeader: "User Identity & Authentication",
    connectedAs: (email: string) => `Connected as ${email}`,
    notSignedIn: "Not signed in · Running in local-first standalone mode",
    disconnect: "Disconnect & Wipe Tokens",
    browserSignInHeader: "Browser Sign-In (OAuth Client IDs)",
    browserSignInNote:
      "On the web tier you sign in with your own OAuth client IDs — QuizRadar is local-first and holds no client secrets. Tokens stay in memory for ~1 hour and are never persisted.",
    desktopSignInHeader: "Desktop Sign-In (OAuth Client IDs)",
    desktopSignInNote:
      "Google sign-in works out of the box — the desktop app ships a Google client ID together with its secret, and signs in with PKCE. Microsoft works out of the box too; add your own Azure app client ID only if your university tenant requires one.",
    googleClientIdLabel: "Google OAuth Client ID (Web application)",
    googleClientIdPlaceholder: "1234567890-abc123.apps.googleusercontent.com",
    googleDesktopClientIdLabel: "Google OAuth Client ID (optional override)",
    googleDesktopClientIdHint:
      "QuizRadar ships a working Google client (project quizradar-511922), so sign-in needs nothing from you. Paste your own client ID only to use a different OAuth app — a Web application client additionally needs its secret in the field below.",
    googleDesktopClientSecretLabel: "Google OAuth Client Secret (optional override)",
    googleDesktopClientSecretHint:
      "Only needed for a client ID you paste yourself: Google refuses a secretless token exchange for Web application clients. Stored in the OS keyring (never in the database, the logs or the web bundle). Leave empty to use the bundled secret.",
    googleBrowserClientIdHint:
      "The browser tier ships a public client ID (an identifier, never a secret). Add this app's origin — e.g. http://localhost:5173 — to the client's Authorized JavaScript origins, or paste your own client ID.",
    teamsClientIdLabel: "Microsoft Azure App Client ID",
    teamsClientIdPlaceholder: "00000000-0000-0000-0000-000000000000",
    teamsDesktopClientIdLabel: "Microsoft App (Client) ID (optional)",
    teamsDesktopClientIdHint:
      "Azure portal → App registrations → your app → Overview. Leave empty to use the bundled Microsoft Graph Command Line Tools registration.",
    redirectUriLabel: (uri: string) => `Register this redirect URI on your OAuth app: ${uri}`,
    desktopRedirectUriNote:
      "Register http://127.0.0.1 (Google) and http://localhost (Microsoft) — the port is picked at runtime and ignored by both providers.",
    openGoogleConsole: "Open Google Cloud Console → Credentials",
    openAzureConsole: "Open Azure → App registrations",
    browserSignInSaved: "OAuth client IDs saved",
    coursesHeader: "Enrolled Courses & Timetable Slots",
    addCourse: "Add Course",
    reopenOnboarding: "Re-open Onboarding Wizard",
    timetableImportTitle: "Import Timetable from Image (AI)",
    timetableImportSub:
      "Upload a screenshot of your weekly timetable — Gemini Vision reads the courses and class slots, and you review them before anything is saved.",
    timetableImportButton: "Select Timetable Image",
    timetableImportExtracting: "Analyzing timetable with Gemini Vision…",
    timetableImportNoKey:
      "Add and validate a Gemini API key in the Account tab first — the image is sent to Google's Gemini API (see the free-tier disclosure there).",
    timetableImportManual: "Enter courses and slots manually instead",
    integrationsHeader: "Data Sources & Calendar",
    gcalAutoPush: "Auto-sync assessments to Google Calendar (consents first)",
    gcalClassesPush: "Sync weekly timetable classes to Google Calendar",
    gcalPushNow: "Sync to Google Calendar Now",
    notificationPrefsTitle: "Notification Preferences",
    notificationPrefsNote:
      "[Mobile only] Notification scheduling operates natively on Android with T-24h and morning digest alerts.",
    feedsTitle: "Subscribed iCalendar Feeds (.ics)",
    addFeed: "Add Feed",
    feedNamePlaceholder: "Feed Name (e.g. Physics Dept)",
    feedUrlPlaceholder: "https://example.com/calendar.ics",
    feedHttpsError: "Feed URL must start with https://",
    noFeeds: "No external .ics feeds subscribed.",
    backupHeader: "Data Backup, Migration & Device Pairing",
    exportBackup: "Export Backup (JSON)",
    importBackup: "Import Backup (JSON)",
    pairPhoneTitle: "Transfer to Android Mobile",
    pairPhoneHelp:
      "Export a secret-free JSON backup file to import on your Android phone or another device.",
    updaterHeader: "Software Updates",
    checkUpdates: "Check for Updates",
    resetDatabase: "Reset All Local Data",
    resetDatabaseWarn: "Permanently wipe all courses, assessments, and cached data on this device.",
  },

  search: {
    title: "Search Radar & Timetable",
    placeholder: "Search quizzes, courses, professors, topics... (Esc to close)",
    clearQuery: "Clear search",
    recents: "Recent Searches",
    noResults: (q: string) => `No results found for "${q}"`,
    typeAll: "All",
    typeAssessments: "Assessments",
    typeCourses: "Courses",
    typeClasses: "Classes",
    instructions: "Use ↑↓ arrows to navigate, Enter to select, Esc to close",
  },

  practice: {
    title: "Practice Quiz",
    practiceQuizAction: "Practice Quiz",
    aiProvenance: "Generated by Gemini AI",
    localFallbackProvenance: "Authored locally from your topics",
    localFallbackSubtext:
      "Generated on-device from syllabus topics without contacting external AI servers",
    questionProgress: (current: number, total: number) => `Question ${current} of ${total}`,
    score: (correct: number, total: number) => `Score: ${correct}/${total} Correct`,
    restart: "Restart Quiz",
    correctFeedback: "Correct answer!",
    incorrectFeedback: "Incorrect answer.",
    explanationHeader: "Explanation & Topical Guidance",
    loading: "Generating practice quiz…",
    emptyQuestions: "No practice questions available for this assessment.",
  },

  pomodoro: {
    title: "Focus Pomodoro",
    modePomodoro: "Focus (25m)",
    modeShortBreak: "Short Break (5m)",
    modeLongBreak: "Long Break (15m)",
    start: "Start",
    pause: "Pause",
    reset: "Reset",
    markTopicDone: "Mark current study topic completed",
    startForTopic: "Start a focus session for",
    topicMarkedDone: (topic: string) => `Topic marked completed: ${topic}`,
    sessionComplete: "Pomodoro session complete!",
    sessionSubtext: "Great focus work! Take a short break to recharge.",
  },

  schedulePreview: {
    title: "Timetable Extraction Preview",
    subtitle:
      "Review the courses and class slots extracted from your timetable image before saving.",
    coursesCount: (count: number) => `${count} course${count === 1 ? "" : "s"} identified`,
    slotsCount: (count: number) => `${count} weekly class slot${count === 1 ? "" : "s"} identified`,
    droppedWarning: (c: number, s: number) =>
      `Honest notice: ${c} unrecognized course line(s) and ${s} invalid slot time(s) were dropped.`,
    replacesCurrent: (c: number, s: number) =>
      `Applying this replaces your current timetable (${c} course${c === 1 ? "" : "s"}, ${s} slot${s === 1 ? "" : "s"}).`,
    applyAction: "Apply & Save to Timetable",
    discardAction: "Discard Extraction",
    manualAction: "Enter Manually Instead",
  },

  courseModal: {
    titleAdd: "Add Course",
    titleEdit: "Edit Course",
    codeLabel: "Course Code (e.g. CSE241)",
    nameLabel: "Course Name (e.g. Digital Logic Design)",
    colorLabel: "Course Color Palette",
    colorOption: (hex: string) => `Use course colour ${hex}`,
    slotsHeader: "Weekly Recurring Class Slots",
    addSlot: "Add Class Slot",
    dayLabel: "Day",
    timeLabel: "Time (HH:MM)",
    startTimeLabel: "Start time",
    endTimeLabel: "End time",
    roomLabel: "Room",
    typeLabel: "Type",
    groupLabel: "Section / Group",
    slotField: (slotNumber: number, field: string) => `Slot ${slotNumber} · ${field}`,
    slotRemove: (slotNumber: number) => `Remove slot ${slotNumber}`,
    saveCourse: "Save Course",
  },

  eventModal: {
    titleAdd: "Add Custom Calendar Event",
    titleEdit: "Edit Custom Calendar Event",
    titleLabel: "Event Title",
    courseLabel: "Associated Course (Optional)",
    dateLabel: "Date (YYYY-MM-DD)",
    timeLabel: "Time Range",
    roomLabel: "Location / Desk",
    notesLabel: "Notes & Objectives",
    saveEvent: "Save Event",
  },

  confirm: {
    defaultTitle: "Are you sure?",
    confirmAction: "Confirm",
    cancelAction: "Cancel",
  },

  accountProfile: {
    title: "Account Profile",
    storageKeyring: "Tokens stored in this device's OS keyring",
    storageMemory: "Web tier: tokens stay in memory for this session only",
    connectGoogle: "Connect Google Account",
    connectMicrosoft: "Connect Microsoft Teams",
    signOutGoogle: "Disconnect Google",
    signOutMicrosoft: "Disconnect Microsoft Teams",
    fullSettings: "Full Settings",
    signOutConfirmTitle: "Disconnect account?",
    signOutConfirmBody:
      "This wipes the stored tokens on this device only. Your courses, assessments and settings stay untouched.",
    signOutConfirmAction: "Disconnect & Wipe Tokens",
    scopesNote:
      "QuizRadar requests read-only Gmail and read/write access to its own Google Calendar events. Nothing else.",
  },
} as const;

export type Copy = typeof copy;
