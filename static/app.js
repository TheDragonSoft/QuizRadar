// Google Calendar Exact UI Replication Logic

let currentWeekIndex = 0; // 0 = Fall 2026 active week (Oct 18-24), 1 = June 2026 reference week
let scheduleData = null;
let quizzesData = [];
let enabledCourses = new Set();

// Week definitions
const WEEKS = [
  {
    monthLabel: 'October 2026',
    activeDayIndex: 0, // Sunday 18 is active day
    days: [
      { name: 'SUN', num: 18, active: true },
      { name: 'MON', num: 19, active: false },
      { name: 'TUE', num: 20, active: false },
      { name: 'WED', num: 21, active: false },
      { name: 'THU', num: 22, active: false },
      { name: 'FRI', num: 23, active: false },
      { name: 'SAT', num: 24, active: false }
    ],
    mode: 'university' // uses user's university schedule & quizzes
  },
  {
    monthLabel: 'June 2026',
    activeDayIndex: 2, // Tuesday 30 is active day (from image!)
    days: [
      { name: 'SUN', num: 28, active: false },
      { name: 'MON', num: 29, active: false },
      { name: 'TUE', num: 30, active: true },
      { name: 'WED', num: 1, active: false },
      { name: 'THU', num: 2, active: false },
      { name: 'FRI', num: 3, active: false },
      { name: 'SAT', num: 4, active: false }
    ],
    mode: 'reference' // reference classes shown in screenshot
  }
];

// Reference classes from screenshot image
const REFERENCE_CLASSES = [
  // Monday
  { day: 1, title: 'Calculus II', subtitle: 'Room 214 · Dr. Reyes', time: '9am – 10:15am', start: '09:00', end: '10:15', colorKey: 'blue' },
  { day: 1, title: 'Organic Chemistry', subtitle: 'Science Hall 110', time: '10:30am – 11:45am', start: '10:30', end: '11:45', colorKey: 'green' },
  { day: 1, title: 'Lunch', subtitle: '', time: '12pm – 1pm', start: '12:00', end: '13:00', colorKey: 'orange' },
  { day: 1, title: 'World History', subtitle: 'Humanities 305', time: '1:30pm – 2:45pm', start: '13:30', end: '14:45', colorKey: 'purple' },
  { day: 1, title: 'Chem Lab', subtitle: 'Lab Wing B', time: '3pm – 5pm', start: '15:00', end: '17:00', colorKey: 'green' },

  // Tuesday
  { day: 2, title: 'English Lit', subtitle: 'Room 118 · Ms. Okafor', time: '9:30am – 10:45am', start: '09:30', end: '10:45', colorKey: 'red' },
  { day: 2, title: 'Spanish III', subtitle: 'Lang Center 4', time: '11am – 12:15pm', start: '11:00', end: '12:15', colorKey: 'cyan' },
  { day: 2, title: 'Study Hall', subtitle: 'Library', time: '1pm – 2:30pm', start: '13:00', end: '14:30', colorKey: 'pink' },
  { day: 2, title: 'Calculus II', subtitle: 'Room 214 · Dr. Reyes', time: '3pm – 4:15pm', start: '15:00', end: '16:15', colorKey: 'blue' },

  // Wednesday
  { day: 3, title: 'Calculus II', subtitle: 'Room 214 · Dr. Reyes', time: '9am – 10:15am', start: '09:00', end: '10:15', colorKey: 'blue' },
  { day: 3, title: 'Organic Chemistry', subtitle: 'Science Hall 110', time: '10:30am – 11:45am', start: '10:30', end: '11:45', colorKey: 'green' },
  { day: 3, title: 'Lunch', subtitle: '', time: '12pm – 1pm', start: '12:00', end: '13:00', colorKey: 'orange' },
  { day: 3, title: 'World History', subtitle: 'Humanities 305', time: '1:30pm – 2:45pm', start: '13:30', end: '14:45', colorKey: 'purple' },
  { day: 3, title: 'Physics', subtitle: 'Science Hall 220', time: '3pm – 4:15pm', start: '15:00', end: '16:15', colorKey: 'cyan' },

  // Thursday
  { day: 4, title: 'English Lit', subtitle: 'Room 118 · Ms. Okafor', time: '9:30am – 10:45am', start: '09:30', end: '10:45', colorKey: 'red' },
  { day: 4, title: 'Spanish III', subtitle: 'Lang Center 4', time: '11am – 12:15pm', start: '11:00', end: '12:15', colorKey: 'cyan' },
  { day: 4, title: 'Lunch', subtitle: '', time: '12:30pm – 1:30pm', start: '12:30', end: '13:30', colorKey: 'orange' },
  { day: 4, title: 'World History', subtitle: 'Humanities 305', time: '1:30pm – 2:45pm', start: '13:30', end: '14:45', colorKey: 'purple' },
  { day: 4, title: 'Chem Lab', subtitle: 'Lab Wing B', time: '3pm – 5pm', start: '15:00', end: '17:00', colorKey: 'green' },

  // Friday
  { day: 5, title: 'Calculus II', subtitle: 'Quiz · Room 214', time: '9am – 10:15am', start: '09:00', end: '10:15', colorKey: 'blue', isQuiz: true },
  { day: 5, title: 'Physics', subtitle: 'Science Hall 220', time: '10:30am – 11:45am', start: '10:30', end: '11:45', colorKey: 'cyan' },
  { day: 5, title: 'Lunch', subtitle: '', time: '12pm – 1pm', start: '12:00', end: '13:00', colorKey: 'orange' },
  { day: 5, title: 'Art Studio', subtitle: 'Fine Arts 12', time: '1:30pm – 3pm', start: '13:30', end: '15:00', colorKey: 'pink' }
];

// Exact Google Calendar color palette
const GCAL_COLORS = {
  blue: { bg: '#d2e3fc', border: '#1a73e8', text: '#174ea6' },
  green: { bg: '#ceead6', border: '#1e8e3e', text: '#137333' },
  purple: { bg: '#f3e8fd', border: '#a142f4', text: '#7627bb' },
  red: { bg: '#fce8e6', border: '#d93025', text: '#c5221f' },
  cyan: { bg: '#cbf0f8', border: '#12b5cb', text: '#007b83' },
  orange: { bg: '#feefe3', border: '#e37400', text: '#b06000' },
  pink: { bg: '#fce4ec', border: '#e91e63', text: '#c2185b' }
};

document.addEventListener('DOMContentLoaded', async () => {
  await fetchBackendData();
  renderApp();
});

async function fetchBackendData() {
  try {
    const [schedRes, quizRes] = await Promise.all([
      fetch('/api/schedule'),
      fetch('/api/quizzes')
    ]);
    scheduleData = await schedRes.json();
    quizzesData = await quizRes.json();

    if (scheduleData && scheduleData.courses) {
      scheduleData.courses.forEach(c => enabledCourses.add(c.id));
    }
  } catch (e) {
    console.error('Error fetching data:', e);
  }
}

function renderApp() {
  renderHeader();
  renderMiniCalendar();
  renderSidebarCalendars();
  renderDaysHeader();
  renderEventGrid();
  lucide.createIcons();
}

function renderHeader() {
  const week = WEEKS[currentWeekIndex];
  document.getElementById('calendar-title').innerText = week.monthLabel;
  document.getElementById('mini-month-label').innerText = week.monthLabel;
}

// Render Mini Calendar with Google's week highlight pill
function renderMiniCalendar() {
  const container = document.getElementById('mini-calendar-days');
  container.innerHTML = '';
  const week = WEEKS[currentWeekIndex];

  if (week.mode === 'reference') {
    // June 2026
    const days = [
      { d: 25, cur: false }, { d: 26, cur: false }, { d: 27, cur: false }, { d: 28, cur: false }, { d: 29, cur: false }, { d: 30, cur: false }, { d: 31, cur: false },
      { d: 1, cur: true }, { d: 2, cur: true }, { d: 3, cur: true }, { d: 4, cur: true }, { d: 5, cur: true }, { d: 6, cur: true }, { d: 7, cur: true },
      { d: 8, cur: true }, { d: 9, cur: true }, { d: 10, cur: true }, { d: 11, cur: true }, { d: 12, cur: true }, { d: 13, cur: true }, { d: 14, cur: true },
      { d: 15, cur: true }, { d: 16, cur: true }, { d: 17, cur: true }, { d: 18, cur: true }, { d: 19, cur: true }, { d: 20, cur: true }, { d: 21, cur: true },
      { d: 22, cur: true }, { d: 23, cur: true }, { d: 24, cur: true }, { d: 25, cur: true }, { d: 26, cur: true }, { d: 27, cur: true }, { d: 28, cur: true },
      { d: 29, cur: true, inWeek: true }, { d: 30, cur: true, inWeek: true, active: true }, { d: 1, cur: false, inWeek: true }, { d: 2, cur: false, inWeek: true }, { d: 3, cur: false, inWeek: true }, { d: 4, cur: false, inWeek: true }, { d: 5, cur: false, inWeek: true }
    ];

    days.forEach(item => {
      const span = document.createElement('span');
      let baseClass = 'py-1 text-center font-normal ';
      if (!item.cur) baseClass += 'text-slate-300 ';
      else baseClass += 'text-[#3c4043] cursor-pointer hover:bg-slate-100 rounded-full ';

      if (item.active) {
        span.className = 'py-1 rounded-full bg-[#1a73e8] text-white font-bold text-center';
        span.innerText = item.d;
      } else if (item.inWeek) {
        span.className = baseClass + 'bg-[#e8f0fe]';
        span.innerText = item.d;
      } else {
        span.className = baseClass;
        span.innerText = item.d;
      }
      container.appendChild(span);
    });
  } else {
    // October 2026 (Fall 2026)
    const days = [
      { d: 27, cur: false }, { d: 28, cur: false }, { d: 29, cur: false }, { d: 30, cur: false }, { d: 1, cur: true }, { d: 2, cur: true }, { d: 3, cur: true },
      { d: 4, cur: true }, { d: 5, cur: true }, { d: 6, cur: true }, { d: 7, cur: true }, { d: 8, cur: true }, { d: 9, cur: true }, { d: 10, cur: true },
      { d: 11, cur: true }, { d: 12, cur: true }, { d: 13, cur: true }, { d: 14, cur: true }, { d: 15, cur: true }, { d: 16, cur: true }, { d: 17, cur: true },
      { d: 18, cur: true, inWeek: true, active: true }, { d: 19, cur: true, inWeek: true }, { d: 20, cur: true, inWeek: true }, { d: 21, cur: true, inWeek: true }, { d: 22, cur: true, inWeek: true }, { d: 23, cur: true, inWeek: true }, { d: 24, cur: true, inWeek: true },
      { d: 25, cur: true }, { d: 26, cur: true }, { d: 27, cur: true }, { d: 28, cur: true }, { d: 29, cur: true }, { d: 30, cur: true }, { d: 31, cur: true }
    ];

    days.forEach(item => {
      const span = document.createElement('span');
      let baseClass = 'py-1 text-center font-normal ';
      if (!item.cur) baseClass += 'text-slate-300 ';
      else baseClass += 'text-[#3c4043] cursor-pointer hover:bg-slate-100 rounded-full ';

      if (item.active) {
        span.className = 'py-1 rounded-full bg-[#1a73e8] text-white font-bold text-center';
        span.innerText = item.d;
      } else if (item.inWeek) {
        span.className = baseClass + 'bg-[#e8f0fe]';
        span.innerText = item.d;
      } else {
        span.className = baseClass;
        span.innerText = item.d;
      }
      container.appendChild(span);
    });
  }
}

// Render "My calendars" Course List
function renderSidebarCalendars() {
  const container = document.getElementById('course-list-sidebar');
  container.innerHTML = '';
  const week = WEEKS[currentWeekIndex];

  if (week.mode === 'reference') {
    const list = [
      { name: 'Calculus II', color: '#1a73e8' },
      { name: 'Chemistry', color: '#1e8e3e' },
      { name: 'History', color: '#a142f4' },
      { name: 'English Lit', color: '#d93025' },
      { name: 'Languages', color: '#12b5cb' }
    ];
    list.forEach(item => {
      const label = document.createElement('label');
      label.className = 'flex items-center space-x-3 py-1 cursor-pointer select-none';
      label.innerHTML = `
        <span class="w-4 h-4 rounded-sm flex items-center justify-center text-white text-[10px]" style="background-color: ${item.color};">✓</span>
        <span class="text-xs text-[#3c4043] font-normal">${item.name}</span>
      `;
      container.appendChild(label);
    });
  } else {
    // User's exact Fall 2026 Courses from Image 3
    if (scheduleData && scheduleData.courses) {
      scheduleData.courses.forEach(c => {
        const isChecked = enabledCourses.has(c.id);
        const label = document.createElement('label');
        label.className = 'flex items-center space-x-3 py-1 cursor-pointer select-none hover:bg-slate-50 px-1 rounded transition';
        label.innerHTML = `
          <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="toggleCourseFilter('${c.id}')" class="w-4 h-4 rounded-sm cursor-pointer" style="accent-color: ${c.color};">
          <span class="text-xs text-[#3c4043] font-normal truncate" title="${c.name}">${c.name}</span>
        `;
        container.appendChild(label);
      });
    }
  }
}

function toggleCourseFilter(courseId) {
  if (enabledCourses.has(courseId)) enabledCourses.delete(courseId);
  else enabledCourses.add(courseId);
  renderEventGrid();
}

// Render 7 Day Headers with blue active day circle
function renderDaysHeader() {
  const row = document.getElementById('day-headers-row');
  row.innerHTML = '';
  const week = WEEKS[currentWeekIndex];

  week.days.forEach(day => {
    const col = document.createElement('div');
    col.className = 'flex flex-col items-center justify-center';

    if (day.active) {
      col.innerHTML = `
        <span class="text-[11px] font-medium text-[#1a73e8] tracking-wider uppercase">${day.name}</span>
        <div class="w-11 h-11 rounded-full bg-[#1a73e8] text-white font-google font-normal text-[26px] flex items-center justify-center -mt-0.5 shadow-xs">
          ${day.num}
        </div>
      `;
    } else {
      col.innerHTML = `
        <span class="text-[11px] font-medium text-[#70757a] tracking-wider uppercase">${day.name}</span>
        <span class="text-[26px] font-google text-[#3c4043] font-normal -mt-0.5">
          ${day.num}
        </span>
      `;
    }
    row.appendChild(col);
  });
}

// Convert "HH:MM" (e.g. "09:30") to pixels from 8:00 AM (1 hr = 52px, 1 min = 52/60 = 0.8666px)
function timeToPixels(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const totalMinutes = (h - 8) * 60 + m;
  return totalMinutes * (52 / 60);
}

// Render Event Cards
function renderEventGrid() {
  for (let d = 0; d < 7; d++) {
    const col = document.getElementById(`col-day-${d}`);
    if (col) col.innerHTML = '';
  }

  const week = WEEKS[currentWeekIndex];

  if (week.mode === 'reference') {
    // Render exact cards from Image 1
    REFERENCE_CLASSES.forEach(item => {
      const col = document.getElementById(`col-day-${item.day}`);
      if (!col) return;

      const topPx = timeToPixels(item.start);
      const endPx = timeToPixels(item.end);
      const heightPx = Math.max(endPx - topPx - 2, 26);
      const color = GCAL_COLORS[item.colorKey] || GCAL_COLORS.blue;

      const card = document.createElement('div');
      card.className = 'gcal-event';
      card.style.top = `${topPx}px`;
      card.style.height = `${heightPx}px`;
      card.style.backgroundColor = color.bg;
      card.style.borderLeft = `4px solid ${color.border}`;
      card.style.color = color.text;

      card.innerHTML = `
        <div style="font-weight: 700; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          ${item.title}
        </div>
        ${item.subtitle ? `<div style="font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0.9;">${item.subtitle}</div>` : ''}
        <div style="font-size: 11px; opacity: 0.85;">${item.time}</div>
      `;

      card.onclick = () => openModal(item.title, item.subtitle, item.time, color.border, item.isQuiz);
      col.appendChild(card);
    });
  } else {
    // Render User's Real University Schedule & Quizzes from Image 2 & 3
    if (!scheduleData || !scheduleData.slots) return;

    // Course ID to color mapping
    const courseColorMap = {
      'GSE211': 'blue',    // Calculus / Math
      'CSE263': 'purple',  // Machine Learning
      'CSE261': 'green',   // Algorithms
      'CSE241': 'red',     // Electronic Design
      'CSE252': 'orange',  // Embedded Systems
      'CSE262': 'cyan'     // Software Engineering
    };

    scheduleData.slots.forEach(slot => {
      if (!enabledCourses.has(slot.course_id)) return;

      const col = document.getElementById(`col-day-${slot.day_index}`);
      if (!col) return;

      const topPx = timeToPixels(slot.start_time);
      const endPx = timeToPixels(slot.end_time);
      const heightPx = Math.max(endPx - topPx - 2, 28);

      const colorKey = courseColorMap[slot.course_id] || 'blue';
      const color = GCAL_COLORS[colorKey] || GCAL_COLORS.blue;

      // Find if this class has a quiz
      const quiz = quizzesData.find(q => q.course_id === slot.course_id && (q.day_name === slot.day || q.room === slot.room));

      const card = document.createElement('div');
      card.className = 'gcal-event';
      card.style.top = `${topPx}px`;
      card.style.height = `${heightPx}px`;
      card.style.backgroundColor = color.bg;
      card.style.borderLeft = `4px solid ${color.border}`;
      card.style.color = color.text;

      // Format line 2 as "Quiz · Room" if quiz, otherwise "Room · Type"
      let line2 = `Room ${slot.room} · ${slot.type}`;
      if (quiz) {
        line2 = `${quiz.title} · Room ${slot.room}`;
      }

      card.innerHTML = `
        <div style="font-weight: 700; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${slot.course_name}">
          ${slot.course_name}
        </div>
        <div style="font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: ${quiz ? '700' : '400'};">
          ${line2}
        </div>
        <div style="font-size: 11px; opacity: 0.85;">${slot.display_time}</div>
      `;

      card.onclick = () => openModal(slot.course_name, line2, slot.display_time, color.border, quiz);
      col.appendChild(card);
    });
  }
}

// Modal handler
function openModal(title, subtitle, time, colorBorder, quizObj) {
  const modal = document.getElementById('gcal-modal');
  document.getElementById('modal-color-bar').style.backgroundColor = colorBorder;
  document.getElementById('modal-title').innerText = title;
  document.getElementById('modal-room').innerText = subtitle || 'University Classroom';
  document.getElementById('modal-time').innerText = time;

  const quizBanner = document.getElementById('modal-quiz-banner');
  const quizDesc = document.getElementById('modal-quiz-desc');
  const quizTopics = document.getElementById('modal-quiz-topics');
  quizTopics.innerHTML = '';

  if (quizObj && typeof quizObj === 'object') {
    quizBanner.classList.remove('hidden');
    quizDesc.innerText = quizObj.warnings ? quizObj.warnings.join(' ') : 'Quiz scheduled during this slot.';

    if (quizObj.topics && quizObj.topics.length > 0) {
      quizObj.topics.forEach(t => {
        const chip = document.createElement('span');
        chip.className = 'px-2 py-0.5 rounded text-[11px] bg-purple-100 text-purple-900 font-semibold';
        chip.innerText = t;
        quizTopics.appendChild(chip);
      });
    }

    document.getElementById('modal-gcal-btn').href = quizObj.google_cal_url || '#';
    document.getElementById('modal-ics-btn').href = `/api/calendar/ics/${quizObj.id}`;
    const moodleBtn = document.getElementById('modal-moodle-btn');
    if (quizObj.elearning_url) {
      moodleBtn.href = quizObj.elearning_url;
      moodleBtn.classList.remove('hidden');
    } else {
      moodleBtn.classList.add('hidden');
    }
  } else {
    quizBanner.classList.add('hidden');
    const calTitle = encodeURIComponent(title);
    const calDetails = encodeURIComponent(`${title}\n${subtitle}\n${time}`);
    document.getElementById('modal-gcal-btn').href = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${calTitle}&details=${calDetails}`;
    document.getElementById('modal-ics-btn').href = '#';
    document.getElementById('modal-moodle-btn').classList.add('hidden');
  }

  modal.classList.remove('hidden');
  lucide.createIcons();
}

function closeModal() {
  document.getElementById('gcal-modal').classList.add('hidden');
}

function changeWeek(delta) {
  currentWeekIndex = (currentWeekIndex + delta + WEEKS.length) % WEEKS.length;
  renderApp();
}

function goToCurrentWeek() {
  currentWeekIndex = 0; // Fall 2026 active week
  renderApp();
}

function toggleDropdown() {
  document.getElementById('view-menu').classList.toggle('hidden');
}

function setView(viewName) {
  document.getElementById('active-view-label').innerText = viewName;
  document.getElementById('view-menu').classList.add('hidden');
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('hidden');
}
