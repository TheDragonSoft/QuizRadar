/**
 * Single source of truth for user-facing strings across QuizRadar web & desktop.
 * Enforces honesty doctrine copy and prepares the app for i18n without hardcoded literals.
 */

export const copy = {
  brand: {
    name: "QuizRadar",
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
    syncFailed: "Sync Failed",
    themeLight: "Switch to light mode",
    themeDark: "Switch to dark mode",
    themeToggleAria: "Toggle light or dark theme",
    userSignIn: "Sign in",
    settings: "Settings",
    settingsAria: "Open settings",
    updateAvailable: "Update Available",
  },

  sidebar: {
    miniCalendarTitle: "Mini Calendar",
    coursesHeader: "Courses",
    noCoursesEnrolled: "No courses enrolled",
    layersHeader: "Layers",
    layerExams: "Exams & Deadlines",
    layerClasses: "Class Schedule",
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
  },

  pullToRefresh: {
    pulling: "Pull to refresh",
    release: "Release to scan sources",
    syncing: "Scanning sources…",
  },

  dashboard: {
    kpiUpcomingTitle: "Next 7 Days",
    kpiUpcomingEmpty: "Nothing scheduled in the next 7 days",
    kpiReadinessTitle: "Exam Readiness",
    kpiReadinessSubtext: "Mastery across all upcoming assessments",
    kpiReadinessCounts: (done: number, total: number) =>
      `${done} of ${total} topic${total === 1 ? "" : "s"} mastered`,
    kpiSyncTitle: "Connected Sources",
    kpiSyncActive: (count: number) => `${count} source${count === 1 ? "" : "s"} active`,
    kpiSyncNone: "No sources connected",

    subtabs: {
      study: "Study",
      assessments: "Assessments",
      overview: "Overview",
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
      viewOnCalendarAction: "View Blocks on Week Calendar",
      dismissTitle: "Dismiss banner",
    },

    recommendationsTitle: "What Should I Study?",
    recommendationsSubtitle:
      "Prioritized study recommendations based on your upcoming exams and remaining topics",
    recommendationsEmpty: "No active study recommendations. You're all caught up!",
    scheduleAt: "@",
    topicsCompletedProgress: (done: number, total: number) => `${done}/${total} topics`,

    timelineTitle: "All Assessments",
    timelineSubtitle: "Live radar of quizzes, assignments, midterms, and finals",
    filterAll: "All",
    filterUpcomingOnly: "All Upcoming",
    sourcePillGmail: "Gmail",
    sourcePillMoodle: "Moodle",
    sourcePillTeams: "Teams",
    sourcePillClassroom: "Classroom",
    sourcePillManual: "Manual",
    sourcePillFeed: "Feeds",
  },

  tasks: {
    summaryLine: (pending: number, upcoming: number, hours: number | null) =>
      hours !== null
        ? `${pending} pending topics across ${upcoming} upcoming exams • Est. ${hours} hrs`
        : `${pending} pending topics across ${upcoming} upcoming exams`,
    filterAllCourses: "All Courses",
    readinessTitle: "Exam Readiness",
    avgBadge: "avg",
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
    timeGutterAria: "Time of day",
    daysHeaderAria: "Week days",
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
    comingFromV4Title: "Coming from QuizRadar v4?",
    comingFromV4Subtitle:
      "Restore your courses, timetable, grades, and completed topics directly from a v4 backup JSON.",
    importV4Action: "Import v4 Backup",
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
    themeTitle: "Visual Theme",
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
    quotaText: (count: number) => `AI calls today: ${count}/~250 (resets midnight PT)`,
    quotaCapNote: "Free tier quota resets every day at midnight Pacific Time (PT).",
    keyPlaceholder: "Paste AI Studio API key (AIzaSy…)",
    validateButton: "Validate Key",
    keyValid: "Key validated & stored in OS Keyring",
    keyInvalid: "Invalid API key",
    aiEnabledLabel:
      "Enable Gemini AI features (Timetable Vision, Task Optimization, Practice Quizzes)",
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
    coursesHeader: "Enrolled Courses & Timetable Slots",
    addCourse: "Add Course",
    reopenOnboarding: "Re-open Onboarding Wizard",
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
    pairPhoneTitle: "Pair with Android Mobile",
    pairPhoneHelp:
      "Export a secret-free backup file to import on your Android phone, or connect directly on your local Wi-Fi.",
    updaterHeader: "Software Updates",
    checkUpdates: "Check for Updates",
    resetDatabase: "Reset All Local Data",
    resetDatabaseWarn: "Permanently wipe all courses, assessments, and cached data on this device.",
  },

  search: {
    title: "Search Radar & Timetable",
    placeholder: "Search quizzes, courses, professors, topics... (Esc to close)",
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
    slotsHeader: "Weekly Recurring Class Slots",
    addSlot: "Add Class Slot",
    dayLabel: "Day",
    timeLabel: "Time (HH:MM)",
    roomLabel: "Room",
    typeLabel: "Type",
    groupLabel: "Section / Group",
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
} as const;

export type Copy = typeof copy;
