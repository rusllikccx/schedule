/**
 * @fileoverview Data transformation utilities for converting raw KPI Campus API payloads
 * into strongly-typed internal Schedule structures.
 */

import { LessonType, type SlotNumber, type WeekMap, type ApiDay } from '../types';
import { DAYS, TIME_TO_SLOT } from '../constants';
import { findOnlineLinkEntry } from '../services/linkMatcher';

/**
 * Maps raw KPI API tag and type strings to the corresponding {@link LessonType} enum.
 *
 * @param typeTag - Short type code (e.g. "lec", "prac", "lab").
 * @param typeName - Localized Ukrainian name (e.g. "Лек", "Прак", "Лаб").
 * @returns Strongly-typed {@link LessonType} enum member.
 *
 * @example
 * ```ts
 * parseType('lec', 'Лек'); // => LessonType.Lecture (1)
 * ```
 */
export function parseType(typeTag?: string, typeName?: string): LessonType {
    if (typeTag === 'lec' || typeName === 'Лек') return LessonType.Lecture;
    if (typeTag === 'prac' || typeName === 'Прак') return LessonType.Practice;
    if (typeTag === 'lab' || typeName === 'Лаб') return LessonType.Lab;
    return LessonType.Other;
}

/**
 * Determines the academic slot index (1 to 6) based on a lesson start time string.
 *
 * @param timeString - Time string in "HH:MM" or "HH:MM:SS" format (e.g. "08:30" or "8:30").
 * @returns SlotNumber between 1 and 6 (defaults to 1 if unmapped).
 *
 * @example
 * ```ts
 * getSlotByTime('10:25'); // => 2
 * ```
 */
export function getSlotByTime(timeString: string): SlotNumber {
    const trimmed = (timeString || '').trim();
    if (trimmed in TIME_TO_SLOT) {
        return TIME_TO_SLOT[trimmed]!;
    }
    const [h, m] = trimmed.split(':').map(Number);
    const timeFormatted = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    return TIME_TO_SLOT[timeFormatted] ?? 1;
}

/**
 * Generates an empty {@link WeekMap} containing empty slot records for all 6 days (mon through sat).
 *
 * @returns Clean, initialized {@link WeekMap} instance.
 */
export function createEmptyWeekMap(): WeekMap {
    return {
        mon: {},
        tue: {},
        wed: {},
        thu: {},
        fri: {},
        sat: {}
    };
}

/**
 * Converts a raw array of {@link ApiDay} objects received from the Campus API
 * into a structured, indexed {@link WeekMap}.
 * Automatically binds matching online video conference links and passwords.
 *
 * @param apiDays - Raw API days array from the API response payload.
 * @returns Normalized {@link WeekMap} ready for UI rendering.
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
            const onlineInfo = findOnlineLinkEntry(pair.name, lecturerName);

            daySlots[slotNum]!.push({
                type: parseType(pair.tag, pair.type),
                title: pair.name,
                lecturer: lecturerName,
                location: pair.location || null,
                link: onlineInfo ? onlineInfo.link : '',
                password: onlineInfo?.password
            });
        }
    }

    return weekMap;
}
