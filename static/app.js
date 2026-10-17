// QuizRadar — Google Calendar Frontend Logic

let scheduleData = null;
let quizzesData = [];
let enabledCourses = new Set();
let currentView = 'week';

document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  renderSidebar();
  renderCalendar();
  lucide.createIcons();

  // Scroll to 8 AM / active morning slot
  const scrollArea = document.getElementById('calendar-scroll-area');
  if (scrollArea) {
    scrollArea.scrollTop = 0;
  }
});

async function loadData() {
  try {
    const [schedRes, quizRes] = await Promise.all([
      fetch('/api/schedule'),
      fetch('/api/quizzes')
    ]);
    scheduleData = await schedRes.json();
    quizzesData = await quizRes.json();

    // Default all courses enabled
    if (scheduleData && scheduleData.courses) {
      scheduleData.courses.forEach(c => enabledCourses.add(c.id));
    }
  } catch (err) {
    console.error('Failed to load schedule or quizzes:', err);
    showToast('Failed to load schedule data', true);
  }
}

// Render "My Calendars" Course List in Left Sidebar
function renderSidebar() {
  const container = document.getElementById('course-checkboxes');
  if (!container || !scheduleData) return;
  container.innerHTML = '';

  scheduleData.courses.forEach(c => {
    const item = document.createElement('label');
    item.className = 'flex items-center space-x-3 cursor-pointer py-1 select-none hover:bg-slate-50 px-2 rounded-lg transition';
    item.innerHTML = `
      <input type="checkbox" checked onchange="toggleCourse('${c.id}')" class="w-4 h-4 rounded text-blue-600 focus:ring-0 cursor-pointer" style="accent-color: ${c.color};">
      <span class="w-3 h-3 rounded-full shrink-0" style="background-color: ${c.color};"></span>
      <span class="text-xs font-medium text-slate-700 truncate" title="${c.name}">${c.name}</span>
    `;
    container.appendChild(item);
  });

  // Add Special Quiz Radar filter
  const quizFilter = document.createElement('label');
  quizFilter.className = 'flex items-center space-x-3 cursor-pointer py-1.5 select-none hover:bg-purple-50 px-2 rounded-lg transition border-t border-slate-100 mt-2';
  quizFilter.innerHTML = `
    <span class="w-3.5 h-3.5 flex items-center justify-center text-xs">⚡</span>
    <span class="text-xs font-bold text-purple-700 truncate">Highlighted Quizzes</span>
  `;
  container.appendChild(quizFilter);
}

function toggleCourse(courseId) {
  if (enabledCourses.has(courseId)) {
    enabledCourses.delete(courseId);
  } else {
    enabledCourses.add(courseId);
  }
  renderCalendar();
}

// Convert "HH:MM" (e.g. "08:00") to minutes from 08:00 AM
function timeToMinutesFrom8AM(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return (h - 8) * 60 + m;
}

// Render Calendar Grid Events
function renderCalendar() {
  if (!scheduleData || !scheduleData.slots) return;

  // Clear day columns (0 to 6)
  for (let d = 0; d < 7; d++) {
    const col = document.getElementById(`day-col-${d}`);
    if (col) col.innerHTML = '';
  }

  scheduleData.slots.forEach(slot => {
    // Check if course is enabled
    if (!enabledCourses.has(slot.course_id)) return;

    const col = document.getElementById(`day-col-${slot.day_index}`);
    if (!col) return;

    const course = scheduleData.courses.find(c => c.id === slot.course_id) || {
      color: '#4285F4',
      bg: '#E8F0FE',
      border: '#1A73E8'
    };

    // Find if there is an active quiz in this slot
    const matchingQuiz = quizzesData.find(q => 
      q.course_id === slot.course_id && 
      (q.day_name === slot.day || q.room === slot.room)
    );

    const startMinutes = timeToMinutesFrom8AM(slot.start_time);
    const endMinutes = timeToMinutesFrom8AM(slot.end_time);
    const duration = endMinutes - startMinutes;

    // 1 minute = 1 pixel (time-slot is 60px per hour)
    const topPx = startMinutes;
    const heightPx = Math.max(duration - 2, 28);

    const eventEl = document.createElement('div');
    eventEl.className = `cal-event absolute left-1 right-1 rounded-md p-2 overflow-hidden flex flex-col justify-between text-left select-none ${matchingQuiz ? 'ring-2 ring-purple-600 shadow-md z-10' : ''}`;
    eventEl.style.top = `${topPx}px`;
    eventEl.style.height = `${heightPx}px`;
    eventEl.style.backgroundColor = course.bg;
    eventEl.style.borderLeft = `4px solid ${course.border}`;
    eventEl.style.color = '#202124';

    let quizBadge = '';
    if (matchingQuiz) {
      quizBadge = `
        <div class="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] font-bold text-white bg-purple-700 quiz-glow mb-1 self-start shadow-xs">
          <span>⚡</span>
          <span>${matchingQuiz.title}</span>
        </div>
      `;
    }

    eventEl.innerHTML = `
      <div>
        ${quizBadge}
        <div class="font-google font-bold text-xs leading-tight truncate" title="${slot.course_name}">
          ${slot.course_name}
        </div>
        <div class="text-[11px] font-medium text-slate-600 truncate mt-0.5">
          ${slot.type} · Room ${slot.room} ${slot.group ? `(Group ${slot.group})` : ''}
        </div>
      </div>
      <div class="text-[10px] text-slate-500 font-normal">
        ${slot.display_time}
      </div>
    `;

    eventEl.onclick = () => openModal(slot, course, matchingQuiz);
    col.appendChild(eventEl);
  });

  lucide.createIcons();
}

// Open Google Calendar Event Detail Modal
function openModal(slot, course, quiz) {
  const modal = document.getElementById('event-modal');
  document.getElementById('modal-stripe').style.backgroundColor = course.color;
  document.getElementById('modal-type-badge').innerText = slot.type;
  document.getElementById('modal-type-badge').style.backgroundColor = course.bg;
  document.getElementById('modal-type-badge').style.color = course.border;
  document.getElementById('modal-group-badge').innerText = slot.group ? `Group ${slot.group}` : 'All Groups';

  document.getElementById('modal-course-name').innerText = slot.course_name;
  document.getElementById('modal-time-slot').innerHTML = `
    <i data-lucide="clock" class="w-4 h-4 text-slate-400 inline"></i>
    <span>${slot.day}, ${slot.display_time}</span>
  `;
  document.getElementById('modal-room').innerHTML = `
    <i data-lucide="map-pin" class="w-4 h-4 text-slate-400 inline"></i>
    <span>Room ${slot.room} · MSA University Campus</span>
  `;

  // Quiz Callout
  const quizCallout = document.getElementById('modal-quiz-callout');
  const quizWarnings = document.getElementById('modal-quiz-warnings');
  const topicsBox = document.getElementById('modal-topics-box');
  const topicsList = document.getElementById('modal-topics-list');
  quizWarnings.innerHTML = '';
  topicsList.innerHTML = '';

  if (quiz) {
    quizCallout.classList.remove('hidden');
    document.getElementById('modal-quiz-title').innerText = `${quiz.title} (${quiz.display_time})`;

    if (quiz.warnings && quiz.warnings.length > 0) {
      quiz.warnings.forEach(w => {
        const li = document.createElement('li');
        li.innerText = w;
        quizWarnings.appendChild(li);
      });
    }

    if (quiz.topics && quiz.topics.length > 0) {
      topicsBox.classList.remove('hidden');
      quiz.topics.forEach(t => {
        const span = document.createElement('span');
        span.className = 'px-2.5 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-800 border border-slate-200';
        span.innerText = t;
        topicsList.appendChild(span);
      });
    } else {
      topicsBox.classList.add('hidden');
    }

    // Google Calendar 1-click link
    document.getElementById('modal-google-cal-btn').href = quiz.google_cal_url || '#';
    document.getElementById('modal-ics-link').href = `/api/calendar/ics/${quiz.id}`;

    const moodleLink = document.getElementById('modal-moodle-link');
    if (quiz.elearning_url) {
      moodleLink.href = quiz.elearning_url;
      moodleLink.classList.remove('hidden');
    } else {
      moodleLink.classList.add('hidden');
    }
  } else {
    quizCallout.classList.add('hidden');
    topicsBox.classList.add('hidden');

    // Create a regular class calendar URL
    const calTitle = encodeURIComponent(`[${slot.course_id}] ${slot.course_name} (${slot.type})`);
    const calDetails = encodeURIComponent(`Course: ${slot.course_name}\nRoom: ${slot.room}\nType: ${slot.type}\nGroup: ${slot.group}`);
    const calLoc = encodeURIComponent(`Room ${slot.room}, MSA University`);
    document.getElementById('modal-google-cal-btn').href = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${calTitle}&details=${calDetails}&location=${calLoc}`;
    document.getElementById('modal-ics-link').href = '#';
    document.getElementById('modal-moodle-link').classList.add('hidden');
  }

  modal.classList.remove('hidden');
  lucide.createIcons();
}

function closeModal() {
  document.getElementById('event-modal').classList.add('hidden');
}

function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  sb.classList.toggle('hidden');
}

function goToToday() {
  document.getElementById('calendar-month-title').innerText = 'October 2026';
  showToast('Centered on October 18, 2026');
}

function prevWeek() {
  document.getElementById('calendar-month-title').innerText = 'October 2026 (Week 3)';
  showToast('Viewing Previous Week');
}

function nextWeek() {
  document.getElementById('calendar-month-title').innerText = 'October 2026 (Week 5)';
  showToast('Viewing Next Week');
}

function toggleViewDropdown() {
  document.getElementById('view-dropdown').classList.toggle('hidden');
}

function setView(view) {
  currentView = view;
  document.getElementById('current-view-name').innerText = view.charAt(0).toUpperCase() + view.slice(1);
  document.getElementById('view-dropdown').classList.add('hidden');
  showToast(`Switched to ${view} view`);
}

async function triggerSync() {
  const btn = document.getElementById('sync-btn');
  const icon = document.getElementById('sync-icon');
  const text = document.getElementById('sync-text');

  icon.classList.add('animate-spin');
  text.innerText = 'Syncing...';
  showToast('Checking Gmail for quiz announcements...');

  try {
    const res = await fetch('/api/sync', { method: 'POST' });
    const data = await res.json();
    showToast(data.message || 'Synced successfully!');
    await loadData();
    renderCalendar();
  } catch (err) {
    showToast('Sync failed', true);
  } finally {
    icon.classList.remove('animate-spin');
    text.innerText = 'Sync Gmail';
    lucide.createIcons();
  }
}

function showToast(msg, isError = false) {
  const toast = document.getElementById('toast');
  const toastText = document.getElementById('toast-text');
  const toastIcon = document.getElementById('toast-icon');

  toastText.innerText = msg;
  if (isError) {
    toastIcon.setAttribute('data-lucide', 'alert-circle');
    toastIcon.className = 'w-4 h-4 text-red-400';
  } else {
    toastIcon.setAttribute('data-lucide', 'check-circle');
    toastIcon.className = 'w-4 h-4 text-emerald-400';
  }
  lucide.createIcons();

  toast.className = 'fixed bottom-6 right-6 z-50 flex items-center space-x-3 px-5 py-3 rounded-xl bg-slate-900 text-white shadow-2xl transition transform translate-y-0 opacity-100';
  setTimeout(() => {
    toast.className = 'fixed bottom-6 right-6 z-50 flex items-center space-x-3 px-5 py-3 rounded-xl bg-slate-900 text-white shadow-2xl transition transform translate-y-20 opacity-0 pointer-events-none';
  }, 3500);
}
