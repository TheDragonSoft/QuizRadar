/**
 * Typed domain models matching the phase-07 Tauri IPC contract and core types.
 * Pure types — no runtime side-effects.
 */

export interface Course {
  id: string;
  name: string;
  color: string;
  bg?: string | null;
  border?: string | null;
  credits?: number | null;
  maxAbsences?: number | null;
  max_absences?: number | null;
}

export interface ScheduleSlot {
  id: string;
  day: string;
  dayIndex: number;
  courseId: string;
  courseName: string;
  type: string;
  group?: string | null;
  room?: string | null;
  startTime: string;
  endTime: string;
  displayTime: string;
  hasQuiz?: boolean;
  quizTitle?: string | null;
  weekParity?: "all" | "week_a" | "week_b" | null;
  week_parity?: "all" | "week_a" | "week_b" | null;
}

export interface ScheduleData {
  semester?: string | null;
  courses: Course[];
  slots: ScheduleSlot[];
}

export type UrgencyLevel = "critical" | "high" | "medium" | "upcoming" | "past";

export interface Assessment {
  id: string;
  courseId?: string | null;
  courseName?: string | null;
  title: string;
  assessmentType: string;
  dateIso?: string | null;
  dayName?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  displayTime?: string | null;
  room?: string | null;
  group?: string | null;
  instructor?: string | null;
  isUpcoming: boolean;
  daysUntil?: number | null;
  urgencyLevel: UrgencyLevel;
  priorityScore: number;
  topics: string[];
  warnings: string[];
  aiInferenceNote?: string | null;
  aiStudyPlan?: string | null;
  estimatedStudyHours?: number | null;
  elearningUrl?: string | null;
  googleCalUrl?: string | null;
  gcalSynced?: boolean;
  gcalEventId?: string | null;
  color?: string | null;
  bg?: string | null;
  border?: string | null;
  semester?: string | null;
  emailSubject?: string | null;
  emailSentDate?: string | null;
  source: string;
  sourceIcon?: string | null;
  weightagePercent?: number | null;
  achievedScore?: number | null;
  maxScore?: number | null;
  conflictWarning?: string | null;
  /**
   * Provenance: the source run that last reported this announcement, and
   * the run in which the source stopped reporting it (the announcement was
   * retired - kept in the store with the reason, but no longer upcoming).
   */
  lastSeenSourceRun?: string | null;
  retiredSourceRun?: string | null;
  // Rust snake_case aliases for WASM interoperability
  course_id?: string | null;
  course_name?: string | null;
  assessment_type?: string;
  date_iso?: string | null;
  day_name?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  display_time?: string | null;
  is_upcoming?: boolean;
  days_until?: number | null;
  urgency_level?: UrgencyLevel;
  priority_score?: number;
  weightage_percent?: number | null;
  achieved_score?: number | null;
  max_score?: number | null;
  last_seen_source_run?: string | null;
  retired_source_run?: string | null;
}

export interface TopicCheckItem {
  topicIndex: number;
  title: string;
  completed: boolean;
  key: string;
  /** Rust twin (`topic`). The shape adapter keeps both in sync. */
  topic?: string | null;
}

export interface StudyRecommendation {
  assessmentId: string;
  courseId?: string | null;
  courseName?: string | null;
  title: string;
  assessmentType: string;
  dateIso?: string | null;
  displayTime?: string | null;
  daysUntil?: number | null;
  urgencyLevel: string;
  /** v4's uppercase countdown badge ("TODAY" / "TOMORROW" / "IN 4 DAYS"). */
  urgencyBadge?: string | null;
  priorityScore: number;
  color?: string | null;
  whyStudyNow: string;
  aiStudyPlan?: string | null;
  /** Exam rules the announcement carried ("Bring a calculator", …). */
  warnings?: string[];
  /** Completed-topics share for this card (100 when it has no topics). Rust sends it required. */
  progressPercent?: number;
  topics: TopicCheckItem[];
}

export interface ConflictAlert {
  assessmentAId: string;
  assessmentBId: string;
  titleA?: string;
  titleB?: string;
  /** The two courses in conflict (`course_a` / `course_b` on the wire). */
  courseA?: string | null;
  courseB?: string | null;
  dateA: string;
  dateB: string;
  severity: "critical" | "warning";
  hoursBetween: number;
  message: string;
  /** True when a study block already covers this pair (`is_mitigated`). */
  isMitigated?: boolean;
  dismissed: boolean;
}

export interface DashboardSummary {
  referenceDate: string;
  nextUp?: Assessment | null;
  upcomingThisWeek: Assessment[];
  allUpcoming: Assessment[];
  examTypeCounts: Record<string, number>;
  studyRecommendations: StudyRecommendation[];
  totalTopicsCount: number;
  completedTopicsCount: number;
  readinessPercent: number;
  conflictAlerts: ConflictAlert[];
  sourcesCount: Record<string, number>;
}

export interface DailyStudyTask {
  id: string;
  key: string;
  assessmentId: string;
  courseId?: string | null;
  courseName?: string | null;
  title: string;
  /** The core's own name for the same value (`assessment_title`). */
  assessmentTitle?: string;
  assessmentType?: string;
  topicTitle: string;
  topicIndex: number;
  dayOffset: number;
  /** The date the task targets (`target_date_iso`). */
  targetDateIso?: string;
  /** The core's honest day label (`display_day`). */
  displayDay?: string;
  estimatedHours?: number | null;
  priorityRank: number;
  completed: boolean;
  reasoning: string;
  /** The core's own name for the same value (`ai_reasoning`). */
  aiReasoning?: string;
  urgency?: string;
  color?: string | null;
  daysUntilAssessment?: number;
  assessmentDateIso?: string;
}

export interface ExamReadinessCard {
  assessmentId: string;
  courseId?: string | null;
  courseName?: string | null;
  title: string;
  assessmentType: string;
  dateIso: string;
  displayDate?: string | null;
  daysUntil: number;
  readinessPercent: number;
  completedCount: number;
  totalCount: number;
  priorityScore: number;
  color?: string | null;
  recommendedFocus: string;
}

export interface DailyStudyCushion {
  date: string;
  wakingHours: number;
  committedHours: number;
  availableHours: number;
  requiredHours?: number | null;
  cushionHours?: number | null;
  isDeficit: boolean;
  deficitHours?: number | null;
  warningNote?: string | null;
  // Rust snake_case wire aliases
  waking_hours?: number;
  committed_hours?: number;
  available_hours?: number;
  required_hours?: number | null;
  cushion_hours?: number | null;
  is_deficit?: boolean;
  deficit_hours?: number | null;
  warning_note?: string | null;
}

export interface DailyStudyDayGroup {
  dayOffset: number;
  date: string;
  displayDay: string;
  isToday: boolean;
  totalEstimatedHours?: number | null;
  tasks: DailyStudyTask[];
  cushion?: DailyStudyCushion | null;
}

export interface StudyTasksPayload {
  days: DailyStudyDayGroup[];
  readinessCards: ExamReadinessCard[];
  totalTasks: number;
  pendingTasks: number;
  completedTasks: number;
  totalHours?: number | null;
  aiGenerated: boolean;
  todayCushion?: DailyStudyCushion | null;
  today_cushion?: DailyStudyCushion | null;
}

export interface CustomCalendarEvent {
  id: string;
  title: string;
  courseId?: string | null;
  eventType?: string | null;
  dateIso?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  room?: string | null;
  notes?: string | null;
  color?: string | null;
}

export interface FeedConfig {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

export interface DesktopConfig {
  autoSyncGcal: boolean;
  syncWeeklyClassesToGcal: boolean;
  geminiEnabled: boolean;
  onboardingCompleted: boolean;
  /** The onboarding "academic rhythm" preset (`01` §4.1 — the track/rhythm
   *  chips are persisted). `null` means the user never picked one. */
  academicTrack?: string | null;
  teamsEnabled: boolean;
  teamsClientId?: string | null;
  teamsAccountName?: string | null;
  teamsAccountEmail?: string | null;
  googleClientId?: string | null;
  moodleEnabled: boolean;
  moodleUrl?: string | null;
  moodleIcalUrl?: string | null;
  classroomEnabled: boolean;
  dismissConflictBanner: boolean;
  syncedGcalMap: Record<string, string>;
  feeds: FeedConfig[];
  customEvents: CustomCalendarEvent[];
  lastGmailSync?: string | null;
  lastGcalSync?: string | null;
  lastBackupPush?: string | null;
  userEmail?: string | null;
  userName?: string | null;
  userPicture?: string | null;
  gradingScale?: "4.0" | "uk_honors" | "ects" | "percentage" | null;
}

export interface DesktopAuthProfile {
  authenticated: boolean;
  email?: string | null;
  name?: string | null;
  picture?: string | null;
  hasGmailScope: boolean;
  hasCalendarScope: boolean;
  hasTeamsAuth: boolean;
}

/**
 * The device's real AI usage for today, read from the store-backed quota
 * ledger. `callsToday` is `null` in tiers that keep no ledger (the browser
 * companion) — the UI then says "not tracked" instead of showing a zero.
 */
export interface AiQuotaUsage {
  callsToday: number | null;
  perModel: Record<string, number>;
  /**
   * True when the tier counts calls in memory for this session instead of a
   * persisted daily ledger (the browser companion). The UI must label such a
   * counter as session-scoped — never as a daily quota.
   */
  sessionScope?: boolean;
  /**
   * True when the tier currently holds a usable AI key (browser companion:
   * in memory for this session only). False means "AI is switched on but no key
   * is in memory right now" - the UI should say so instead of waiting for a
   * failed call to explain it.
   */
  keyInMemory?: boolean;
}

/**
 * The core's `MergeReport` (core/src/store/backup.rs). It crosses the bridge
 * in its raw snake_case shape — it is not a state payload, so the camelCase
 * normalizer never touches it.
 */
export interface MergeReport {
  assessments_replaced: number;
  assessments_kept_newer: number;
  topics_merged: number;
  grades_merged: number;
  events_upserted: number;
  feeds_upserted: number;
  schedule_replaced: boolean;
}

export interface GetStatePayload {
  config: DesktopConfig;
  auth: DesktopAuthProfile;
  schedule: ScheduleData;
  assessments: Assessment[];
  dashboard: DashboardSummary;
  studyTasksPayload: StudyTasksPayload;
}

export type View = "dashboard" | "tasks" | "calendar" | "focus" | "help" | "settings";

/**
 * The Settings page's scrollable sections (the old three-tab modal, promoted
 * to a full-screen page — one scrollable surface with an anchored side rail).
 */
export type SettingsSection = "account" | "courses" | "integrations";

export type ThemeMode =
  | "light"
  | "dark"
  | "obsidian"
  | "solar"
  | "amoled"
  | "amoled-minimal"
  | "amoled-sparkle"
  | "amoled-nebula";

export type SyncStatus = "idle" | "syncing" | "success" | "error";

/**
 * The honest outcome of the last scan. It outlives the transient
 * `syncStatus` (which returns to `idle` a few seconds later) so the scan
 * overlay can show what actually happened instead of stranding the user on
 * a stale "Scanning…" stage.
 */
export interface SyncOutcome {
  status: "success" | "error" | "canceled";
  totalNew: number;
  totalUpdated: number;
  /** The source lines the backend reported — what ran, what was found. */
  notes: string[];
  /** The failure reason, when the scan failed. */
  message?: string;
}

export interface ToastItem {
  id: string;
  message: string;
  type: "info" | "success" | "warning" | "error";
  duration?: number;
}

export interface ModalInstance {
  id: string;
  props?: Record<string, unknown>;
  dismissible?: boolean;
  /**
   * Full-bleed modal: the shell drops its own padding so the modal can own
   * a v4-style header band with a divider and a scrolling body (Settings,
   * Onboarding).
   */
  flush?: boolean;
  /** Panel width (v4 used a 2xl-wide Settings sheet, 3xl for Schedule Preview). */
  size?: "sm" | "md" | "lg" | "xl";
}

export interface LayerToggles {
  exams: boolean;
  classes: boolean;
}

export interface PracticeQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex?: number;
  correct_index?: number;
  explanation: string;
}

export interface PracticeQuizPayload {
  assessmentId?: string;
  assessment_id?: string;
  courseId?: string | null;
  course_id?: string | null;
  assessmentTitle?: string;
  assessment_title?: string;
  questions: PracticeQuestion[];
  generatedByAi?: boolean;
  generated_by_ai?: boolean;
  authoredLocally?: boolean;
  authored_locally?: boolean;
  credit?: { source: string } | null;
}

export interface DesktopExtractedTimetable {
  schedule: ScheduleData;
  droppedCourses?: number;
  dropped_courses?: number;
  droppedSlots?: number;
  dropped_slots?: number;
}

export interface UpdateCheckResult {
  available: boolean;
  currentVersion: string;
  latestVersion?: string | null;
  body?: string | null;
  error?: string | null;
}

export interface SyncResult {
  success: boolean;
  totalNew?: number;
  total_new?: number;
  totalUpdated?: number;
  total_updated?: number;
  notes: string[];
  discoveredTeams?: Course[];
  discovered_teams?: Course[];
}

export interface ConfigUpdate {
  autoSyncGcal?: boolean;
  syncWeeklyClassesToGcal?: boolean;
  geminiEnabled?: boolean;
  onboardingCompleted?: boolean;
  /** The onboarding academic-rhythm preset ("med" | "eng" | "biz"). */
  academicTrack?: string;
  teamsEnabled?: boolean;
  teamsClientId?: string;
  teamsAccountName?: string;
  teamsAccountEmail?: string;
  googleClientId?: string;
  moodleEnabled?: boolean;
  moodleUrl?: string;
  moodleIcalUrl?: string;
  classroomEnabled?: boolean;
  dismissConflictBanner?: boolean;
  userEmail?: string;
  userName?: string;
  userPicture?: string;
  gradingScale?: "4.0" | "uk_honors" | "ects" | "percentage";
}

export interface ExportBackupResult {
  saved: boolean;
  path?: string | null;
  json?: string | null;
}

export interface ImportReport {
  assessmentsImported: number;
  coursesImported: number;
  slotsImported: number;
  gradesImported: number;
  topicsImported: number;
  eventsImported: number;
  customEventsImported?: number;
  feedsImported: number;
  secretsIgnored: string[];
  warnings: string[];
}

export interface CourseGradeSummary {
  courseId: string;
  courseName: string;
  credits?: number | null;
  accumulatedPoints: number;
  totalWeightage: number;
  percentage?: number | null;
  gradePoint?: number | null;
  letterGrade?: string | null;
  course_id?: string;
  course_name?: string;
  accumulated_points?: number;
  total_weightage?: number;
  grade_point?: number | null;
  letter_grade?: string | null;
}

export interface GpaSummary {
  scale: string;
  scaleMax: number;
  totalCredits: number;
  semesterGpa?: number | null;
  courses: CourseGradeSummary[];
  scale_max?: number;
  total_credits?: number;
  semester_gpa?: number | null;
}

export interface Flashcard {
  id: string;
  courseId?: string | null;
  assessmentId?: string | null;
  topic?: string | null;
  front: string;
  back: string;
  boxLevel: number;
  reviewCount?: number;
  review_count?: number;
  nextReviewIso?: string | null;
  lastReviewedIso?: string | null;
  course_id?: string | null;
  assessment_id?: string | null;
  box_level?: number;
  next_review_iso?: string | null;
  last_reviewed_iso?: string | null;
}

export interface QuizAttemptRecord {
  id: string;
  assessmentId: string;
  assessmentTitle: string;
  courseId?: string | null;
  timestamp: string;
  score: number;
  totalQuestions: number;
  percentage: number;
  passed: boolean;
}

export interface MistakeItem {
  id: string;
  attemptId?: string | null;
  assessmentId: string;
  courseId?: string | null;
  topic?: string | null;
  questionId: string;
  questionText: string;
  options: string[];
  selectedIndex: number;
  correctIndex: number;
  explanation: string;
  timestamp: string;
  resolved: boolean;
}

