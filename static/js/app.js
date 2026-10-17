// QuizRadar Frontend Application Logic

let allQuizzes = [];
let currentView = 'calendar'; // 'calendar' or 'cards'
let upcomingOnly = true;
let calendarInstance = null;

document.addEventListener('DOMContentLoaded', async () => {
  initCalendar();
  await loadStatus();
  await loadQuizzes();
  lucide.createIcons();
});

// Initialize FullCalendar 6
function initCalendar() {
  const calendarEl = document.getElementById('calendar');
  calendarInstance = new FullCalendar.Calendar(calendarEl, {
    initialView: 'dayGridMonth',
    initialDate: '2026-10-17', // Centered around the active semester
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'dayGridMonth,timeGridWeek,listMonth'
    },
    buttonText: {
      today: 'Today',
      month: 'Month',
      week: 'Week',
      list: 'Agenda'
    },
    events: [],
    eventClick: function(info) {
      info.jsEvent.preventDefault();
      const quizId = info.event.extendedProps.quizId;
      openQuizById(quizId);
    },
    height: 'auto',
    dayMaxEvents: 3,
  });
  calendarInstance.render();
}

// Load status from backend
async function loadStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data.email) {
      document.getElementById('user-email').innerText = data.email;
    }
  } catch (err) {
    console.error('Error loading status:', err);
  }
}

// Load quizzes from backend
async function loadQuizzes() {
  try {
    const course = document.getElementById('course-select').value;
    const search = document.getElementById('search-input').value;
    let url = `/api/quizzes?upcoming=${upcomingOnly}`;
    if (course !== 'ALL') url += `&course=${encodeURIComponent(course)}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;

    const res = await fetch(url);
    allQuizzes = await res.json();

    updateCalendarEvents(allQuizzes);
    renderCards(allQuizzes);
  } catch (err) {
    console.error('Error fetching quizzes:', err);
    showToast('Failed to load quizzes', true);
  }
}

// Update Calendar events
function updateCalendarEvents(quizzes) {
  if (!calendarInstance) return;
  const events = quizzes.map(q => ({
    id: q.id,
    title: `[${q.course}] ${q.title}`,
    start: q.date_iso,
    backgroundColor: q.color || '#6366f1',
    borderColor: q.color || '#6366f1',
    textColor: '#ffffff',
    extendedProps: {
      quizId: q.id,
      course: q.course,
      instructor: q.instructor,
      isUpcoming: q.is_upcoming
    }
  }));
  calendarInstance.removeAllEvents();
  calendarInstance.addEventSource(events);
}

// Render Cards & Timeline view
function renderCards(quizzes) {
  const container = document.getElementById('quizzes-grid');
  container.innerHTML = '';

  if (quizzes.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-16 text-center text-slate-400">
        <i data-lucide="inbox" class="w-12 h-12 mx-auto text-slate-600 mb-3"></i>
        <p class="text-base font-semibold">No quizzes found matching your filter.</p>
        <p class="text-xs text-slate-500 mt-1">Try toggling "Upcoming Only" or clearing your search.</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  quizzes.forEach(q => {
    const card = document.createElement('div');
    card.className = `rounded-2xl p-5 bg-slate-900/80 border ${q.is_upcoming ? 'border-purple-500/40 shadow-lg shadow-purple-950/20' : 'border-slate-800'} hover:border-purple-500/70 transition flex flex-col justify-between space-y-4 group`;

    // Calculate countdown if upcoming
    let countdownBadge = '';
    if (q.is_upcoming) {
      const target = new Date(q.date_iso);
      const now = new Date('2026-10-17');
      const diffDays = Math.ceil((target - now) / (1000 * 60 * 60 * 24));
      const text = diffDays === 0 ? 'Today!' : diffDays === 1 ? 'Tomorrow' : `In ${diffDays} days`;
      countdownBadge = `<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">${text}</span>`;
    } else {
      countdownBadge = `<span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-400">Completed</span>`;
    }

    // Topics pills
    const topicsHtml = q.topics && q.topics.length > 0 
      ? `<div class="flex flex-wrap gap-1.5 pt-1">
          ${q.topics.slice(0, 3).map(t => `<span class="px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-800 text-slate-300 border border-slate-700">${t}</span>`).join('')}
          ${q.topics.length > 3 ? `<span class="text-[10px] text-slate-500 self-center">+${q.topics.length - 3} more</span>` : ''}
        </div>`
      : '';

    // Warnings snippet
    const warningHtml = q.warnings && q.warnings.length > 0
      ? `<div class="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-200/90 font-medium leading-tight">
          ${q.warnings[0]}
        </div>`
      : '';

    card.innerHTML = `
      <div class="space-y-3 cursor-pointer" onclick="openQuizById('${q.id}')">
        <div class="flex items-center justify-between">
          <span class="px-2.5 py-1 rounded-lg text-xs font-extrabold uppercase tracking-wider" style="background-color: ${q.color}22; color: ${q.color}; border: 1px solid ${q.color}44;">
            ${q.course}
          </span>
          ${countdownBadge}
        </div>
        
        <div>
          <h3 class="text-lg font-bold text-white group-hover:text-purple-300 transition">${q.title}</h3>
          <p class="text-xs text-slate-400 mt-0.5 flex items-center space-x-1">
            <i data-lucide="calendar" class="w-3.5 h-3.5 text-purple-400"></i>
            <span>${q.time_display}</span>
          </p>
        </div>

        ${warningHtml}
        ${topicsHtml}
      </div>

      <!-- Footer Buttons -->
      <div class="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
        <button onclick="openQuizById('${q.id}')" class="text-xs font-semibold text-slate-300 hover:text-white transition flex items-center space-x-1">
          <span>View Details</span>
          <i data-lucide="chevron-right" class="w-3.5 h-3.5"></i>
        </button>

        <a href="${q.google_cal_url}" target="_blank" class="px-3 py-1.5 rounded-lg bg-purple-600/20 hover:bg-purple-600 text-purple-300 hover:text-white border border-purple-500/30 text-xs font-bold transition flex items-center space-x-1.5 shadow-sm">
          <i data-lucide="bell" class="w-3.5 h-3.5"></i>
          <span>Add Reminder</span>
        </a>
      </div>
    `;

    container.appendChild(card);
  });

  lucide.createIcons();
}

// View switcher
function switchView(view) {
  currentView = view;
  const calContainer = document.getElementById('calendar-container');
  const cardsContainer = document.getElementById('cards-container');
  const calBtn = document.getElementById('view-calendar-btn');
  const cardsBtn = document.getElementById('view-cards-btn');

  if (view === 'calendar') {
    calContainer.classList.remove('hidden');
    cardsContainer.classList.add('hidden');
    calBtn.className = "flex items-center space-x-2 px-4 py-2 rounded-lg font-semibold text-xs sm:text-sm transition bg-purple-600 text-white shadow-md";
    cardsBtn.className = "flex items-center space-x-2 px-4 py-2 rounded-lg font-semibold text-xs sm:text-sm transition text-slate-400 hover:text-white";
    if (calendarInstance) {
      setTimeout(() => calendarInstance.render(), 50);
    }
  } else {
    calContainer.classList.add('hidden');
    cardsContainer.classList.remove('hidden');
    cardsBtn.className = "flex items-center space-x-2 px-4 py-2 rounded-lg font-semibold text-xs sm:text-sm transition bg-purple-600 text-white shadow-md";
    calBtn.className = "flex items-center space-x-2 px-4 py-2 rounded-lg font-semibold text-xs sm:text-sm transition text-slate-400 hover:text-white";
  }
}

// Toggle upcoming only filter
function toggleUpcomingFilter() {
  upcomingOnly = !upcomingOnly;
  const btn = document.getElementById('upcoming-toggle');
  if (upcomingOnly) {
    btn.className = "flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
  } else {
    btn.className = "flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition bg-slate-800 text-slate-400 border-slate-700";
  }
  loadQuizzes();
}

// Filter change handler
function applyFilters() {
  loadQuizzes();
}

// Open detail modal by ID
function openQuizById(quizId) {
  const quiz = allQuizzes.find(q => q.id === quizId);
  if (!quiz) return;

  const modal = document.getElementById('detail-modal');
  document.getElementById('modal-title').innerText = quiz.title;
  document.getElementById('modal-date').innerText = quiz.time_display;
  document.getElementById('modal-instructor').innerText = quiz.instructor || 'Instructor';
  document.getElementById('modal-body-preview').innerText = quiz.body_preview || '';

  // Course badge
  const courseBadge = document.getElementById('modal-course-badge');
  courseBadge.innerText = quiz.course;
  courseBadge.style.backgroundColor = `${quiz.color || '#6366f1'}22`;
  courseBadge.style.color = quiz.color || '#6366f1';
  courseBadge.style.border = `1px solid ${quiz.color || '#6366f1'}44`;

  // Status badge
  const statusBadge = document.getElementById('modal-status-badge');
  if (quiz.is_upcoming) {
    statusBadge.innerText = 'Upcoming';
    statusBadge.className = 'px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
  } else {
    statusBadge.innerText = 'Completed / Past';
    statusBadge.className = 'px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-400';
  }

  // Warnings
  const warningsContainer = document.getElementById('modal-warnings-container');
  const warningsList = document.getElementById('modal-warnings-list');
  warningsList.innerHTML = '';
  if (quiz.warnings && quiz.warnings.length > 0) {
    warningsContainer.classList.remove('hidden');
    quiz.warnings.forEach(w => {
      const li = document.createElement('li');
      li.innerText = w;
      warningsList.appendChild(li);
    });
  } else {
    warningsContainer.classList.add('hidden');
  }

  // Topics checklist
  const topicsSection = document.getElementById('modal-topics-section');
  const topicsList = document.getElementById('modal-topics-list');
  topicsList.innerHTML = '';
  if (quiz.topics && quiz.topics.length > 0) {
    topicsSection.classList.remove('hidden');
    quiz.topics.forEach((t, idx) => {
      const item = document.createElement('label');
      item.className = 'flex items-center space-x-3 p-3 rounded-xl bg-slate-950/70 border border-slate-800 hover:border-slate-700 cursor-pointer transition select-none';
      item.innerHTML = `
        <input type="checkbox" id="topic-check-${idx}" class="w-4 h-4 rounded text-purple-600 bg-slate-900 border-slate-700 focus:ring-purple-500">
        <span class="text-xs sm:text-sm font-medium text-slate-300">${t}</span>
      `;
      topicsList.appendChild(item);
    });
  } else {
    topicsSection.classList.add('hidden');
  }

  // Buttons
  document.getElementById('modal-google-btn').href = quiz.google_cal_url || '#';
  document.getElementById('modal-ics-btn').href = `/api/calendar/ics/${quiz.id}`;
  
  const moodleLink = document.getElementById('modal-moodle-link');
  if (quiz.elearning_url) {
    moodleLink.href = quiz.elearning_url;
    moodleLink.classList.remove('hidden');
  } else {
    moodleLink.classList.add('hidden');
  }

  modal.classList.remove('hidden');
  lucide.createIcons();
}

function closeModal() {
  document.getElementById('detail-modal').classList.add('hidden');
}

// Gmail Live Sync Trigger
async function triggerGmailSync() {
  const syncBtn = document.getElementById('sync-btn');
  const syncIcon = document.getElementById('sync-icon');
  const syncText = document.getElementById('sync-text');

  syncBtn.disabled = true;
  syncIcon.classList.add('animate-spin');
  syncText.innerText = 'Scanning Gmail...';
  showToast('Connecting to your university Gmail...', false);

  try {
    const res = await fetch('/api/sync', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, false);
      await loadQuizzes();
    } else {
      showToast('Sync error: ' + (data.error || 'Unknown error'), true);
    }
  } catch (err) {
    console.error('Sync failed:', err);
    showToast('Failed to connect to Gmail', true);
  } finally {
    syncBtn.disabled = false;
    syncIcon.classList.remove('animate-spin');
    syncText.innerText = 'Check Gmail';
    lucide.createIcons();
  }
}

// Toast notification helper
function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toast-message');
  const toastIcon = document.getElementById('toast-icon');

  toastMsg.innerText = message;
  if (isError) {
    toastIcon.setAttribute('data-lucide', 'alert-circle');
    toastIcon.className = 'w-5 h-5 text-red-400';
    toast.className = 'fixed bottom-6 right-6 z-50 flex items-center space-x-3 px-5 py-3.5 rounded-2xl bg-red-950/90 border border-red-700 text-white shadow-2xl transition transform translate-y-0 opacity-100';
  } else {
    toastIcon.setAttribute('data-lucide', 'check-circle');
    toastIcon.className = 'w-5 h-5 text-emerald-400';
    toast.className = 'fixed bottom-6 right-6 z-50 flex items-center space-x-3 px-5 py-3.5 rounded-2xl bg-slate-900 border border-slate-700 text-white shadow-2xl transition transform translate-y-0 opacity-100';
  }
  lucide.createIcons();

  setTimeout(() => {
    toast.className = 'fixed bottom-6 right-6 z-50 flex items-center space-x-3 px-5 py-3.5 rounded-2xl bg-slate-900 border border-slate-700 text-white shadow-2xl transition transform translate-y-24 opacity-0 pointer-events-none';
  }, 4000);
}
