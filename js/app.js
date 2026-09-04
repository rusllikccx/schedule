const API_URL = 'https://api.campus.kpi.ua/schedule/lessons?groupId=5598';
import { TIME_SLOTS, LESSON_TYPES, DAYS, ONLINE_LINKS } from './data.js';



function findOnlineLink(title, lecturerName) {
    const t = (title || '').toLowerCase();
    const l = (lecturerName || '').toLowerCase();

    const match = ONLINE_LINKS.find(entry => {
        const titleMatches = t.includes(entry.title.toLowerCase());
        const lecturerMatches = !entry.lecturer || l.includes(entry.lecturer.toLowerCase());
        return titleMatches && lecturerMatches;
    });

    return match ? match.link : '';
}

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
let scheduleData = { week1: {}, week2: {} };
let hiddenSubjects = JSON.parse(localStorage.getItem('hiddenSubjects')) || [];

const dom = {
    scheduleBody: document.getElementById('schedule-body'),
    weekSelector: document.getElementById('week-selector'),
    mobileDaySelector: document.getElementById('mobile-day-buttons'),
    dayHeaders: document.querySelectorAll('thead th[data-day]')
};

function getSlotByTime(timeString) {
    const [h, m] = timeString.split(':').map(Number);
    const timeFormatted = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const found = TIME_SLOTS.find(s => s.start === timeFormatted);
    return found ? found.slot : 1;
}

function parseType(typeTag, typeName) {
    if (typeTag === 'lec' || typeName === 'Лек') return 1;
    if (typeTag === 'prac' || typeName === 'Прак') return 2;
    if (typeTag === 'lab' || typeName === 'Лаб') return 3;
    return 4;
}

function transformWeekData(apiDays) {
    const weekMap = {};
    DAYS.forEach(d => { weekMap[d.code] = {}; });

    if (!Array.isArray(apiDays)) return weekMap;

    apiDays.forEach(dayObj => {
        const dayMeta = DAYS.find(d => d.key === dayObj.day);
        if (!dayMeta) return;

        (dayObj.pairs || []).forEach(pair => {
            const slotNum = getSlotByTime(pair.time);
            if (!weekMap[dayMeta.code][slotNum]) {
                weekMap[dayMeta.code][slotNum] = [];
            }

            const lecturerName = pair.lecturer ? pair.lecturer.name : '';
            const onlineLink = findOnlineLink(pair.name, lecturerName);

            weekMap[dayMeta.code][slotNum].push({
                type: parseType(pair.tag, pair.type),
                title: pair.name,
                lecturer: lecturerName,
                location: pair.location || null,
                link: onlineLink
            });
        });
    });

    return weekMap;
}

async function fetchSchedule() {
    dom.scheduleBody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">Завантаження розкладу...</td></tr>`;
    try {
        const response = await fetch(API_URL);
        if (!response.ok) throw new Error(`HTTP помилка: ${response.status}`);
        const data = await response.json();

        scheduleData.week1 = transformWeekData(data.scheduleFirstWeek);
        scheduleData.week2 = transformWeekData(data.scheduleSecondWeek);

        renderScheduleTable();
    } catch (err) {
        dom.scheduleBody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-danger">Не вдалося завантажити розклад з API</td></tr>`;
        console.error(err);
    }
}

function createCardHtml(lesson) {
    const typeInfo = LESSON_TYPES[lesson.type] || LESSON_TYPES[4];

    let locationHtml = '';
    if (lesson.location) {
        if (lesson.location.uri) {
            locationHtml = `
                <div class="mt-1">
                    📍 
                    <a href="${encodeURI(lesson.location.uri)}" target="_blank" rel="noopener noreferrer" class="location-link">
                        ауд. ${escapeHtml(lesson.location.title)}
                    </a>
                </div>`;
        } else {
            locationHtml = `<div class="location-text mt-1 text-muted">📍 ауд. ${escapeHtml(lesson.location.title)}</div>`;
        }
    }

    const hideBtnHtml = `<button class="hide-subject-btn" data-title="${escapeHtml(lesson.title)}" style="position: absolute; top: 5px; right: 5px; background: transparent; border: none; cursor: pointer; color: #dc3545; font-weight: bold; z-index: 10;" title="Приховати дисципліну">✕</button>`;

    const innerContent = `
        <div style="position: relative;">
            ${hideBtnHtml}
            <span class="badge-type">${typeInfo.name}</span>
            <div class="lesson-title" ${lesson.link ? 'style="text-decoration: underline;"' : ''}>${escapeHtml(lesson.title)}</div>
        </div>
        <div class="lesson-footer mt-1">
            ${lesson.lecturer ? `<div>${escapeHtml(lesson.lecturer)}</div>` : ''}
            ${locationHtml}
        </div>
    `;

    if (lesson.link) {
        return `<div class="lesson-card ${typeInfo.cssClass} clickable-card" data-url="${encodeURI(lesson.link)}" style="cursor: pointer;" title="Перейти на заняття">${innerContent}</div>`;
    }

    return `<div class="lesson-card ${typeInfo.cssClass}">${innerContent}</div>`;
}

function renderScheduleTable() {
    const weekData = scheduleData[`week${displayedWeek}`] || {};
    let rowsHtml = '';

    for (let i = 0; i < TIME_SLOTS.length; i++) {
        const slot = TIME_SLOTS[i];
        let rowCells = `<td class="time-col">${slot.start}<br><small class="text-muted">${slot.end}</small></td>`;

        for (let j = 0; j < DAYS.length; j++) {
            const day = DAYS[j];
            const lessons = (weekData[day.code]?.[slot.slot] || []).filter(lesson => !hiddenSubjects.includes(lesson.title));
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

dom.weekSelector.querySelectorAll('button').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.week) === displayedWeek);
});

dom.scheduleBody.addEventListener('click', (e) => {
    const hideBtn = e.target.closest('.hide-subject-btn');
    if (hideBtn) {
        e.preventDefault();
        const subjectTitle = hideBtn.dataset.title;
        if (!hiddenSubjects.includes(subjectTitle)) {
            hiddenSubjects.push(subjectTitle);
            localStorage.setItem('hiddenSubjects', JSON.stringify(hiddenSubjects));
            renderScheduleTable();
        }
        return;
    }

    if (e.target.closest('a')) {
        return;
    }

    const clickableCard = e.target.closest('.clickable-card');
    if (clickableCard) {
        window.open(clickableCard.dataset.url, '_blank');
    }
});

function resetHiddenSubjects() {
    hiddenSubjects = [];
    localStorage.removeItem('hiddenSubjects');
    renderScheduleTable();
}

const resetBtn = document.getElementById('reset-hidden-btn');
if (resetBtn) {
    resetBtn.addEventListener('click', resetHiddenSubjects);
}

window.resetHiddenSubjects = resetHiddenSubjects;

fetchSchedule();
setInterval(updateLiveStatus, 60000);