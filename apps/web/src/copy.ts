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
} as const;

export type Copy = typeof copy;
