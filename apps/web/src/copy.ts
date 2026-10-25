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
} as const;

export type Copy = typeof copy;
