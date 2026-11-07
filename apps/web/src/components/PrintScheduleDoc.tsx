import React from "react";
import { useAppStore } from "../state/store";
import { courseDisplayName } from "../lib/coursePalette";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const PrintScheduleDoc: React.FC<{ className?: string }> = ({ className = "" }) => {
  const courses = useAppStore((s) => s.data.schedule.courses || []);
  const slots = useAppStore((s) => s.data.schedule.slots || []);
  const assessments = useAppStore((s) => s.data.assessments || []);
  const recommendations = useAppStore((s) => s.data.dashboard.studyRecommendations || []);
  const config = useAppStore((s) => s.data.config);
  const auth = useAppStore((s) => s.data.auth);

  const studentName = auth.name || config.userName || "Student";
  const studentEmail = auth.email || config.userEmail;
  const printDate = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Group slots by weekday
  const slotsByDay = WEEKDAYS.map((dayName) => {
    const daySlots = slots
      .filter((s) => s.day.toLowerCase() === dayName.toLowerCase())
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    return { dayName, slots: daySlots };
  }).filter((group) => group.slots.length > 0);

  // Chronological upcoming assessments
  const sortedAssessments = [...assessments]
    .filter((a) => a.isUpcoming && a.dateIso)
    .sort((a, b) => (a.dateIso || "").localeCompare(b.dateIso || ""));

  return (
    <div
      data-testid="print-schedule-doc"
      className={`print-only-doc text-black bg-white p-6 font-sans leading-normal ${className}`}
    >
      {/* Document Header */}
      <div className="border-b-2 border-black pb-4 mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight uppercase">QuizRadar Academic Plan</h1>
          <p className="text-xs text-gray-700 mt-0.5">
            Official Class Schedule &amp; Physical Exam Cram Sheet
          </p>
        </div>
        <div className="text-right text-xs text-gray-700">
          <div className="font-bold text-black">{studentName}</div>
          {studentEmail && <div>{studentEmail}</div>}
          <div className="text-[10px] text-gray-500 mt-0.5">Generated {printDate}</div>
        </div>
      </div>

      {/* SECTION 1: WEEKLY CLASS TIMETABLE */}
      <section className="mb-8 print-avoid-break">
        <h2 className="text-sm font-bold uppercase tracking-wider border-b border-gray-400 pb-1 mb-3">
          1. Weekly Class Timetable
        </h2>

        {slotsByDay.length === 0 ? (
          <div className="text-xs text-gray-600 italic py-2">
            No regular weekly classes scheduled.
          </div>
        ) : (
          <div className="space-y-4">
            {slotsByDay.map(({ dayName, slots: daySlots }) => (
              <div key={dayName} className="print-avoid-break">
                <div className="text-xs font-bold uppercase tracking-wide bg-gray-100 px-2 py-1 border-l-4 border-black mb-1">
                  {dayName}
                </div>
                <table className="w-full text-xs text-left border-collapse border border-gray-300">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-300 text-[11px] font-semibold">
                      <th className="py-1 px-2 border-r border-gray-300 w-28">Time</th>
                      <th className="py-1 px-2 border-r border-gray-300 w-24">Code</th>
                      <th className="py-1 px-2 border-r border-gray-300">Course Title</th>
                      <th className="py-1 px-2 border-r border-gray-300 w-24">Type</th>
                      <th className="py-1 px-2 border-r border-gray-300 w-28">Room</th>
                      <th className="py-1 px-2 w-24">Cycle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {daySlots.map((slot) => {
                      const parityLabel =
                        slot.weekParity === "week_a"
                          ? "Week A"
                          : slot.weekParity === "week_b"
                            ? "Week B"
                            : "Weekly";
                      return (
                        <tr key={slot.id} className="border-b border-gray-200">
                          <td className="py-1 px-2 border-r border-gray-200 font-mono font-medium">
                            {slot.startTime} – {slot.endTime}
                          </td>
                          <td className="py-1 px-2 border-r border-gray-200 font-bold">
                            {slot.courseId}
                          </td>
                          <td className="py-1 px-2 border-r border-gray-200">
                            {courseDisplayName(slot.courseId, courses)}
                          </td>
                          <td className="py-1 px-2 border-r border-gray-200">
                            {slot.type || "Class"}
                          </td>
                          <td className="py-1 px-2 border-r border-gray-200 font-mono">
                            {slot.room || "—"}
                          </td>
                          <td className="py-1 px-2 text-[10px] text-gray-600">{parityLabel}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* SECTION 2: EXAM CRAM SHEET & TOPIC REVISION CHECKLIST */}
      <section className="print-avoid-break">
        <h2 className="text-sm font-bold uppercase tracking-wider border-b border-gray-400 pb-1 mb-3">
          2. Upcoming Assessments &amp; Topic Cram Checklist
        </h2>

        {sortedAssessments.length === 0 ? (
          <div className="text-xs text-gray-600 italic py-2">
            No upcoming assessments currently recorded.
          </div>
        ) : (
          <div className="space-y-4">
            {sortedAssessments.map((a, idx) => {
              const rec = recommendations.find((r) => r.assessmentId === a.id);
              const topics = (a.topics && a.topics.length > 0)
                ? a.topics
                : (rec?.topics.map((t) => t.title) || []);

              return (
                <div
                  key={a.id}
                  className="border border-gray-300 rounded p-3 print-avoid-break space-y-2"
                >
                  <div className="flex items-start justify-between border-b border-gray-200 pb-1.5">
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wide">
                        #{idx + 1}. {a.title}
                      </div>
                      <div className="text-[11px] text-gray-700">
                        {courseDisplayName(a.courseId, courses)} ({a.courseId}) · {a.assessmentType}
                      </div>
                    </div>
                    <div className="text-right text-xs">
                      <div className="font-bold">{a.dateIso}</div>
                      <div className="text-[10px] text-gray-600">
                        {a.startTime ? `${a.startTime}${a.endTime ? ` – ${a.endTime}` : ""}` : "All day"}
                        {a.room ? ` · Room: ${a.room}` : ""}
                      </div>
                    </div>
                  </div>

                  {/* Topic checklist boxes for physical wall or binder review */}
                  <div>
                    <div className="text-[11px] font-bold text-gray-800 uppercase tracking-wider mb-1">
                      Syllabus Topic Checklist:
                    </div>
                    {topics.length > 0 ? (
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        {topics.map((topic, tIdx) => (
                          <div key={tIdx} className="flex items-start gap-2">
                            <span className="font-mono text-sm leading-none">[ ]</span>
                            <span className="leading-tight">{topic}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[11px] text-gray-500 italic">
                        No individual topics extracted yet. Review lecture notes and syllabus.
                      </div>
                    )}
                  </div>

                  {/* Physical Notes / Formula Box */}
                  <div className="pt-2 border-t border-gray-200 border-dashed">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                      Key Formulas &amp; Exam Hall Reminders:
                    </div>
                    <div className="h-10 border border-gray-200 rounded bg-gray-50/50" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Footer */}
      <div className="mt-8 pt-3 border-t border-gray-300 text-[10px] text-gray-500 flex justify-between">
        <span>QuizRadar · Local-First University Dashboard</span>
        <span>Page 1 of 1 · High-DPI Vector Print</span>
      </div>
    </div>
  );
};
