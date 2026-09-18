/**
 * @fileoverview Static constants, time slot tables, academic metadata, and storage keys.
 */

import { LessonType, type TimeSlot, type LessonTypeInfo, type DayMeta } from './types';

/**
 * Public REST endpoint for fetching the official KPI Campus schedule for the target group.
 */
export const API_URL = 'https://api.campus.kpi.ua/schedule/lessons?groupId=5598';

/**
 * Internal API endpoint for managing and retrieving online meeting links.
 */
export const LINKS_API_URL = '/api/links';

/**
 * Academic timetable configuring all standard daily pair slots (1 to 6)
 * with exact start/end times and minute offsets from midnight.
 */
export const TIME_SLOTS: readonly TimeSlot[] = [
    { slot: 1, start: '08:30', end: '10:05', startMin: 510, endMin: 605 },
    { slot: 2, start: '10:25', end: '12:00', startMin: 625, endMin: 720 },
    { slot: 3, start: '12:20', end: '13:55', startMin: 740, endMin: 835 },
    { slot: 4, start: '14:15', end: '15:50', startMin: 855, endMin: 950 },
    { slot: 5, start: '16:10', end: '17:45', startMin: 970, endMin: 1065 },
    { slot: 6, start: '18:05', end: '19:40', startMin: 1085, endMin: 1180 }
] as const;

/**
 * Fast lookup dictionary mapping various time string representations (e.g. "08:30", "8:30:00")
 * to their corresponding slot number (1..6).
 */
export const TIME_TO_SLOT: Readonly<Record<string, 1 | 2 | 3 | 4 | 5 | 6>> = {
    '08:30': 1, '8:30': 1, '08:30:00': 1, '8:30:00': 1,
    '10:25': 2, '10:25:00': 2,
    '12:20': 3, '12:20:00': 3,
    '14:15': 4, '14:15:00': 4,
    '16:10': 5, '16:10:00': 5,
    '18:05': 6, '18:05:00': 6
} as const;

/**
 * Visual styling and localization metadata for each {@link LessonType}.
 */
export const LESSON_TYPES: Readonly<Record<LessonType, LessonTypeInfo>> = {
    [LessonType.Lecture]: { name: 'Лекція', cssClass: 'type-lecture' },
    [LessonType.Practice]: { name: 'Практика', cssClass: 'type-practice' },
    [LessonType.Lab]: { name: 'Лабораторна', cssClass: 'type-lab' },
    [LessonType.Other]: { name: 'Заняття', cssClass: 'type-other' }
} as const;

/**
 * List of days in the academic week (Monday to Saturday) with localized names and metadata.
 */
export const DAYS: readonly DayMeta[] = [
    { key: 'Пн', code: 'mon', num: 1, fullName: 'Понеділок', shortName: 'Пн' },
    { key: 'Вв', code: 'tue', num: 2, fullName: 'Вівторок', shortName: 'Вт' },
    { key: 'Ср', code: 'wed', num: 3, fullName: 'Середа', shortName: 'Ср' },
    { key: 'Чт', code: 'thu', num: 4, fullName: 'Четвер', shortName: 'Чт' },
    { key: 'Пт', code: 'fri', num: 5, fullName: "П'ятниця", shortName: 'Пт' },
    { key: 'Сб', code: 'sat', num: 6, fullName: 'Субота', shortName: 'Сб' }
] as const;

/**
 * Centralized registry of local storage and cookie keys used across the application.
 */
export const STORAGE_KEYS = {
    /** Key for storing cached ScheduleData payload */
    scheduleCache: 'kpi_schedule_cache_v1',
    /** Key for tracking when the schedule was last updated */
    scheduleUpdatedAt: 'kpi_schedule_updated_at_v1',
    /** Key for storing cached online meeting links array */
    onlineLinks: 'kpi_online_links_v1',
    /** Key for tracking when online links were last modified */
    onlineLinksUpdatedAt: 'kpi_online_links_updated_at_v1',
    /** Key for storing HTTP ETag header value for conditional HTTP 304 requests */
    onlineLinksETag: 'kpi_online_links_etag_v1',
    /** Key for storing the 24h admin session Bearer token */
    adminSession: 'kpi_admin_session_v1',
    /** Key for storing user-hidden subject titles array */
    hiddenSubjects: 'hidden_subjects',
    /** Key for storing edit mode toggle state */
    showHideControls: 'show_hide_controls'
} as const;
