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

const SCHEDULE_CACHE_KEY = 'kpi_schedule_cache_v1';

/**
 * Retrieves cached schedule data from localStorage if present.
 */
export function getCachedSchedule(): ScheduleData | null {
    if (typeof window === 'undefined') return null;
    try {
        const item = localStorage.getItem(SCHEDULE_CACHE_KEY);
        if (!item) return null;
        return JSON.parse(item) as ScheduleData;
    } catch (e) {
        console.warn('Failed to read schedule from localStorage cache', e);
        return null;
    }
}

/**
 * Saves schedule data to localStorage.
 */
export function setCachedSchedule(data: ScheduleData): void {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(SCHEDULE_CACHE_KEY, JSON.stringify(data));
    } catch (e) {
        console.warn('Failed to save schedule to localStorage cache', e);
    }
}

/**
 * Fetches and transforms schedule data for both weeks.
 * Supports consuming the early fetch promise initiated in HTML head,
 * and caches results in localStorage for stale-while-revalidate behavior.
 */
export async function fetchSchedule(
    url = API_URL,
    fetchFn: typeof fetch = fetch
): Promise<ScheduleData> {
    let rawData: ApiScheduleResponse | null = null;

    // Check if early fetch was started in HTML head
    if (typeof window !== 'undefined' && window.__SCHEDULE_PROMISE__) {
        try {
            rawData = await window.__SCHEDULE_PROMISE__;
        } catch {
            rawData = null;
        } finally {
            window.__SCHEDULE_PROMISE__ = undefined;
        }
    }

    // Fallback if early fetch wasn't present or failed
    if (!rawData) {
        const response = await fetchFn(url);
        if (!response.ok) {
            throw new Error(`HTTP помилка: ${response.status}`);
        }
        rawData = await response.json();
    }

    if (!rawData || !rawData.scheduleFirstWeek) {
        throw new Error('Отримано порожню або некоректну відповідь від API');
    }

    const transformed: ScheduleData = {
        week1: transformWeekData(rawData.scheduleFirstWeek),
        week2: transformWeekData(rawData.scheduleSecondWeek)
    };

    // Save to permanent client cache
    setCachedSchedule(transformed);

    return transformed;
}

