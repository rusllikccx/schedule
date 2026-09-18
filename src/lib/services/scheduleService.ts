/**
 * @fileoverview High-level schedule management and persistence orchestration.
 *
 * Provides:
 * 1. Persistent caching of `ScheduleData` and `OnlineLink[]` in browser storage.
 * 2. Formatted timestamp retrieval for UI status badges.
 * 3. Schedule-wide re-application of online meeting links.
 */

import type { ScheduleData, WeekMap, OnlineLink, DayCode, SlotNumber } from '../types';
import { STORAGE_KEYS } from '../constants';
import { getStorageItem, setStorageItem } from '../storage';
import { findOnlineLinkEntry, setActiveOnlineLinks } from './linkMatcher';
import rawLinks from '$lib/data/links.json';

/**
 * Retrieves the locally cached {@link ScheduleData} from `localStorage`.
 *
 * @returns Cached {@link ScheduleData} object, or `null` if no cache exists.
 */
export function getCachedSchedule(): ScheduleData | null {
    return getStorageItem<ScheduleData | null>(STORAGE_KEYS.scheduleCache, null);
}

/**
 * Persists {@link ScheduleData} to `localStorage` along with the current update timestamp.
 *
 * @param data - Full bi-weekly schedule payload to save.
 */
export function setCachedSchedule(data: ScheduleData): void {
    setStorageItem(STORAGE_KEYS.scheduleCache, data);
    setStorageItem(STORAGE_KEYS.scheduleUpdatedAt, new Date().toISOString());
}

/**
 * Returns the localized date & time string when the schedule was last updated.
 *
 * @returns Formatted timestamp string (e.g. "15.09.2026, 12:30:00"), or `null` if not recorded.
 */
export function getScheduleUpdatedAt(): string | null {
    const ts = getStorageItem<string | null>(STORAGE_KEYS.scheduleUpdatedAt, null);
    return ts ? new Date(ts).toLocaleString('uk-UA') : null;
}

/**
 * Loads the active list of online meeting links from `localStorage`,
 * falling back to the bundled `links.json` data if uninitialized.
 * Automatically initializes in-memory lookup indexes.
 *
 * @returns Array of currently active {@link OnlineLink} records.
 */
export function loadCachedOnlineLinks(): OnlineLink[] {
    const cached = getStorageItem<OnlineLink[] | null>(STORAGE_KEYS.onlineLinks, null);
    if (Array.isArray(cached) && cached.length > 0) {
        setActiveOnlineLinks(cached);
        return cached;
    }
    setActiveOnlineLinks(rawLinks);
    return rawLinks;
}

/**
 * Persists an array of {@link OnlineLink} records to `localStorage` and updates search indexes.
 *
 * @param links - Array of links to cache.
 */
export function cacheOnlineLinks(links: OnlineLink[]): void {
    setActiveOnlineLinks(links);
    setStorageItem(STORAGE_KEYS.onlineLinks, links);
    setStorageItem(STORAGE_KEYS.onlineLinksUpdatedAt, new Date().toISOString());
}

/**
 * Returns the localized date & time string when online meeting links were last updated.
 *
 * @returns Formatted timestamp string or `null`.
 */
export function getLinksUpdatedAt(): string | null {
    const ts = getStorageItem<string | null>(STORAGE_KEYS.onlineLinksUpdatedAt, null);
    return ts ? new Date(ts).toLocaleString('uk-UA') : null;
}

/**
 * Re-maps all lesson items in a {@link ScheduleData} instance to link and password values
 * dynamically resolved from the currently active meeting links index.
 *
 * Produces an immutable new {@link ScheduleData} instance without mutating the input.
 *
 * @param schedule - Existing bi-weekly schedule data.
 * @returns Updated {@link ScheduleData} with fresh online links and passwords applied.
 *
 * @example
 * ```ts
 * scheduleData = applyLinksToSchedule(scheduleData);
 * ```
 */
export function applyLinksToSchedule(schedule: ScheduleData): ScheduleData {
    function updateWeek(weekMap: WeekMap): WeekMap {
        const newMap: WeekMap = {
            mon: {}, tue: {}, wed: {}, thu: {}, fri: {}, sat: {}
        };
        const dayCodes = Object.keys(weekMap) as DayCode[];
        for (const dayCode of dayCodes) {
            const daySlotLessons = weekMap[dayCode];
            newMap[dayCode] = {};
            if (!daySlotLessons) continue;

            const slotKeys = Object.keys(daySlotLessons).map(Number) as SlotNumber[];
            for (const slotNum of slotKeys) {
                const lessons = daySlotLessons[slotNum] || [];
                newMap[dayCode][slotNum] = lessons.map(lesson => {
                    const onlineInfo = findOnlineLinkEntry(lesson.title, lesson.lecturer);
                    return {
                        ...lesson,
                        link: onlineInfo ? onlineInfo.link : '',
                        password: onlineInfo?.password
                    };
                });
            }
        }
        return newMap;
    }

    return {
        week1: updateWeek(schedule.week1),
        week2: updateWeek(schedule.week2)
    };
}
