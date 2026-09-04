import { TIME_SLOTS, LESSON_TYPES, DAYS, SCHEDULE_DATA } from './data.js';

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
const escapeHtml = (text) => text ? String(text).replace(/[&<>"']/g, m => ESCAPE_MAP[m]) : '';

function getActualCurrentWeek() {
    const now = new Date();
    const startDay = new Date(now);
    const day = startDay.getDay();
    startDay.setDate(startDay.getDate() + ((day === 0 ? -6 : 1) - day));
    startDay.setHours(0, 0, 0, 0);
    return (Math.floor(startDay.getTime() / 604800000) % 2 === 0) ? 1 : 2;
}

let displayedWeek = getActualCurrentWeek();
let selectedMobileDay = new Date().getDay() || 1;

const dom = {
    scheduleBody: document.getElementById('schedule-body'),
    weekSelector: document.getElementById('week-selector'),
    mobileDaySelector: document.getElementById('mobile-day-buttons'),
    dayHeaders: document.querySelectorAll('thead th[data-day]')
};

function createCardHtml(lesson) {
    const typeInfo = LESSON_TYPES[lesson.type] || LESSON_TYPES[4];
    const extraHtml = lesson.extra ? `<div class="lesson-footer">${escapeHtml(lesson.extra)}</div>` : '';
    const innerContent = `
        <div>
            <span class="badge-type">${typeInfo.name}</span>
            <div class="lesson-title">${escapeHtml(lesson.title)}</div>
        </div>
        ${extraHtml}
    `;

    if (lesson.link) {
        return `<a href="${encodeURI(lesson.link)}" target="_blank" rel="noopener noreferrer" class="lesson-card ${typeInfo.cssClass}">${innerContent}</a>`;
    }
    return `<div class="lesson-card ${typeInfo.cssClass}">${innerContent}</div>`;
}

function renderScheduleTable() {
    const weekData = SCHEDULE_DATA[`week${displayedWeek}`] || {};
    let rowsHtml = '';

    for (let i = 0; i < TIME_SLOTS.length; i++) {
        const slot = TIME_SLOTS[i];
        let rowCells = `<td class="time-col">${slot.start}<br><small class="text-muted">${slot.end}</small></td>`;

        for (let j = 0; j < DAYS.length; j++) {
            const day = DAYS[j];
            const lessons = weekData[day.key]?.[slot.slot] || [];
            let cellContent = '';

            if (lessons.length > 0) {
                if (lessons.length <= 3) {
                    cellContent = lessons.map(createCardHtml).join('');
                } else {
                    const visibleLessons = lessons.slice(0, 3).map(createCardHtml).join('');
                    const hiddenLessons = lessons.slice(3).map(createCardHtml).join('');
                    const toggleId = `toggle-w${displayedWeek}-${day.num}-${slot.slot}`;

                    cellContent = `
                        ${visibleLessons}
                        <input type="checkbox" id="${toggleId}" class="lessons-toggle">
                        <label for="${toggleId}" class="lessons-toggle-btn">+ Ще ${lessons.length - 3} предметів</label>
                        <div class="lessons-expandable-content">
                            <div class="lessons-expandable-inner d-flex flex-column gap-2 pt-2">${hiddenLessons}</div>
                        </div>
                    `;
                }
            }
            rowCells += `<td data-day="${day.num}" data-slot="${slot.slot}">${cellContent}</td>`;
        }
        rowsHtml += `<tr>${rowCells}</tr>`;
    }

    dom.scheduleBody.innerHTML = rowsHtml;
    
    updateLiveStatus();
    applyMobileDayVisibility();
}

function updateLiveStatus() {
    const actualWeek = getActualCurrentWeek();
    const isCurrentWeek = (displayedWeek === actualWeek);
    const currentDay = new Date().getDay();
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    dom.dayHeaders.forEach(th => {
        const dayNum = Number(th.dataset.day);
        th.classList.toggle('current-day-header', isCurrentWeek && dayNum === currentDay);
    });

    let activeSlot = null;
    if (isCurrentWeek) {
        for (let i = 0; i < TIME_SLOTS.length; i++) {
            if (currentMinutes >= TIME_SLOTS[i].startMin && currentMinutes <= TIME_SLOTS[i].endMin) {
                activeSlot = TIME_SLOTS[i].slot;
                break;
            }
        }
    }

    const cells = dom.scheduleBody.querySelectorAll('td:not(.time-col)');
    cells.forEach(cell => {
        const isToday = isCurrentWeek && (Number(cell.dataset.day) === currentDay);
        const isSlotActive = isToday && (Number(cell.dataset.slot) === activeSlot);

        cell.classList.toggle('current-day-cell', isToday);
        
        const cards = cell.querySelectorAll('.lesson-card');
        cards.forEach(card => card.classList.toggle('current-lesson-active', isSlotActive));
    });
}

function applyMobileDayVisibility() {
    const targetDay = String(selectedMobileDay);
    const allDayElements = document.querySelectorAll('.schedule-table th:not(.time-col), .schedule-table td:not(.time-col)');

    allDayElements.forEach(el => {
        el.classList.toggle('mobile-active-day', el.dataset.day === targetDay);
    });

    dom.mobileDaySelector.querySelectorAll('button').forEach(btn => {
        const isActive = btn.dataset.day === targetDay;
        btn.classList.toggle('btn-primary', isActive);
        btn.classList.toggle('active', isActive);
        btn.classList.toggle('btn-outline-secondary', !isActive);
    });
}

dom.weekSelector.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-week]');
    if (!btn) return;

    const newWeek = Number(btn.dataset.week);
    if (displayedWeek !== newWeek) {
        dom.weekSelector.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        displayedWeek = newWeek;
        renderScheduleTable();
    }
});

dom.mobileDaySelector.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-day]');
    if (!btn) return;

    const newDay = Number(btn.dataset.day);
    if (selectedMobileDay !== newDay) {
        selectedMobileDay = newDay;
        applyMobileDayVisibility();
    }
});

// Ініціалізація
dom.weekSelector.querySelectorAll('button').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.week) === displayedWeek);
});

renderScheduleTable();
setInterval(updateLiveStatus, 60000);