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
  gcalSynced: boolean;
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
}

export interface TopicCheckItem {
  topicIndex: number;
  title: string;
  completed: boolean;
  key: string;
}

export interface StudyRecommendation {
  assessmentId: string;
  courseId?: string | null;
  courseName?: string | null;
  title: string;
  assessmentType: string;
  daysUntil?: number | null;
  urgencyLevel: string;
  priorityScore: number;
  color?: string | null;
  whyStudyNow: string;
  topics: TopicCheckItem[];
}

export interface ConflictAlert {
  assessmentAId: string;
  assessmentBId: string;
  titleA?: string;
  titleB?: string;
  dateA: string;
  dateB: string;
  severity: "critical" | "warning";
  hoursBetween: number;
  message: string;
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
  title: string;
  topicTitle: string;
  topicIndex: number;
  dayOffset: number;
  estimatedHours?: number | null;
  priorityRank: number;
  completed: boolean;
  reasoning: string;
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

export interface DailyStudyDayGroup {
  dayOffset: number;
  date: string;
  displayDay: string;
  isToday: boolean;
  totalEstimatedHours?: number | null;
  tasks: DailyStudyTask[];
}

export interface StudyTasksPayload {
  days: DailyStudyDayGroup[];
  readinessCards: ExamReadinessCard[];
  totalTasks: number;
  pendingTasks: number;
  completedTasks: number;
  totalHours?: number | null;
  aiGenerated: boolean;
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
  teamsEnabled: boolean;
  teamsClientId?: string | null;
  teamsAccountName?: string | null;
  teamsAccountEmail?: string | null;
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

export interface GetStatePayload {
  config: DesktopConfig;
  auth: DesktopAuthProfile;
  schedule: ScheduleData;
  assessments: Assessment[];
  dashboard: DashboardSummary;
  studyTasksPayload: StudyTasksPayload;
}

export type View = "dashboard" | "tasks" | "calendar" | "focus";

export type ThemeMode = "light" | "dark";

export type SyncStatus = "idle" | "syncing" | "success" | "error";

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
}

export interface LayerToggles {
  exams: boolean;
  classes: boolean;
}
