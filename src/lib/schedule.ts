import { API_URL, TIME_SLOTS, TIME_TO_SLOT, LESSON_TYPES, DAYS } from './constants';
import {
    LessonType,
    type TimeSlot,
    type LessonTypeInfo,
    type DayMeta,
    type OnlineLink,
    type LessonLocation,
    type Lesson,
    type DaySlotLessons,
    type WeekMap,
    type ScheduleData,
    type ApiScheduleResponse,
    type ApiDay,
    type ApiPair
} from './types';
import rawLinks from '$lib/data/links.json';

export { LessonType, API_URL, TIME_SLOTS, TIME_TO_SLOT, LESSON_TYPES, DAYS };
export type {
    TimeSlot,
    LessonTypeInfo,
    DayMeta,
    OnlineLink,
    LessonLocation,
    Lesson,
    DaySlotLessons,
    WeekMap,
    ScheduleData,
    ApiScheduleResponse,
    ApiDay,
    ApiPair
};

export const ONLINE_LINKS: OnlineLink[] = rawLinks;

/**
 * Pre-indexed online link cache for fast lookup.
 */
function createLinkIndex(links: OnlineLink[]) {
    return links.map(entry => ({
        titleLower: entry.title.toLowerCase(),
        lecturerLower: entry.lecturer ? entry.lecturer.toLowerCase() : '',
        link: entry.link
    }));
}

const indexedLinks = createLinkIndex(ONLINE_LINKS);

/**
 * Finds online meeting URL based on subject title and lecturer name.
 */
export function findOnlineLink(title: string, lecturerName?: string): string {
    const t = (title || '').toLowerCase();
    const l = (lecturerName || '').toLowerCase();

    const match = indexedLinks.find(entry => {
        const titleMatches = t.includes(entry.titleLower);
        const lecturerMatches = !entry.lecturerLower || l.includes(entry.lecturerLower);
        return titleMatches && lecturerMatches;
    });

    return match ? match.link : '';
}

/**
 * Calculates current academic week (1 = odd/непарний, 2 = even/парний).
 * Uses Monday-aligned week difference from semester start.
 */
export function getActualCurrentWeek(date = new Date(), semesterStart = new Date(2026, 8, 1)): number {
    const startDay = new Date(date);
    const day = startDay.getDay();
    // Align to Monday of current week
    startDay.setDate(startDay.getDate() + ((day === 0 ? -6 : 1) - day));
    startDay.setHours(0, 0, 0, 0);

    const semStartMonday = new Date(semesterStart);
    const semDay = semStartMonday.getDay();
    semStartMonday.setDate(semStartMonday.getDate() + ((semDay === 0 ? -6 : 1) - semDay));
    semStartMonday.setHours(0, 0, 0, 0);

    const diffWeeks = Math.round((startDay.getTime() - semStartMonday.getTime()) / 604800000);
    return Math.abs(diffWeeks) % 2 === 0 ? 1 : 2;
}

/**
 * Returns lesson slot index (1..6) by start time string (e.g. 08:30 or 8:30).
 */
export function getSlotByTime(timeString: string): number {
    const trimmed = (timeString || '').trim();
    if (TIME_TO_SLOT[trimmed] !== undefined) {
        return TIME_TO_SLOT[trimmed];
    }
    const [h, m] = trimmed.split(':').map(Number);
    const timeFormatted = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    return TIME_TO_SLOT[timeFormatted] ?? 1;
}

/**
 * Maps API tag/type string to strongly-typed LessonType enum.
 */
export function parseType(typeTag?: string, typeName?: string): LessonType {
    if (typeTag === 'lec' || typeName === 'Лек') return LessonType.Lecture;
    if (typeTag === 'prac' || typeName === 'Прак') return LessonType.Practice;
    if (typeTag === 'lab' || typeName === 'Лаб') return LessonType.Lab;
    return LessonType.Other;
}

/**
 * Creates an empty week structure populated with all known day codes.
 */
export function createEmptyWeekMap(): WeekMap {
    const weekMap: WeekMap = {};
    for (const d of DAYS) {
        weekMap[d.code] = {};
    }
    return weekMap;
}

/**
 * Transforms raw API day array into a structured WeekMap.
 */
export function transformWeekData(apiDays?: ApiDay[] | null): WeekMap {
    const weekMap = createEmptyWeekMap();

    if (!Array.isArray(apiDays)) return weekMap;

    for (const dayObj of apiDays) {
        const dayMeta = DAYS.find(d => d.key === dayObj.day);
        if (!dayMeta) continue;

        const daySlots = weekMap[dayMeta.code];

        for (const pair of dayObj.pairs || []) {
            const slotNum = getSlotByTime(pair.time);
            if (!daySlots[slotNum]) {
                daySlots[slotNum] = [];
            }

            const lecturerName = pair.lecturer ? pair.lecturer.name : '';
            const onlineLink = findOnlineLink(pair.name, lecturerName);

            daySlots[slotNum].push({
                type: parseType(pair.tag, pair.type),
                title: pair.name,
                lecturer: lecturerName,
                location: pair.location || null,
                link: onlineLink
            });
        }
    }

    return weekMap;
}

/**
 * Fetches and transforms schedule data for both weeks.
 */
export async function fetchSchedule(
    url = API_URL,
    fetchFn: typeof fetch = fetch
): Promise<ScheduleData> {
    const response = await fetchFn(url);
    if (!response.ok) {
        throw new Error(`HTTP помилка: ${response.status}`);
    }
    const data: ApiScheduleResponse = await response.json();

    return {
        week1: transformWeekData(data.scheduleFirstWeek),
        week2: transformWeekData(data.scheduleSecondWeek)
    };
}
