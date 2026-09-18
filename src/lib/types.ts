/**
 * @fileoverview Core domain and API type definitions for the KPI Schedule application.
 * Defines strict types for lessons, time slots, days, API payloads, and backup records.
 */

/**
 * Enumeration of academic lesson types.
 */
export enum LessonType {
    /** Theoretical lecture class */
    Lecture = 1,
    /** Practical seminar / exercise class */
    Practice = 2,
    /** Laboratory / hands-on practical session */
    Lab = 3,
    /** Other academic sessions, consultations, or exams */
    Other = 4
}

/**
 * Standard three-letter code representing a day of the academic week (Monday to Saturday).
 */
export type DayCode = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';

/**
 * Sequential academic pair/slot number (1st through 6th pair).
 */
export type SlotNumber = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Represents the schedule configuration of a single time slot.
 */
export interface TimeSlot {
    /** Numerical pair index (1..6) */
    slot: SlotNumber;
    /** Human-readable start time in "HH:MM" format (e.g. "08:30") */
    start: string;
    /** Human-readable end time in "HH:MM" format (e.g. "10:05") */
    end: string;
    /** Minutes elapsed from midnight to lesson start (e.g. 510 for 08:30) */
    startMin: number;
    /** Minutes elapsed from midnight to lesson end (e.g. 605 for 10:05) */
    endMin: number;
}

/**
 * Visual metadata and display properties for a specific lesson type.
 */
export interface LessonTypeInfo {
    /** Localized title of the lesson type (e.g. "Лекція", "Практика") */
    name: string;
    /** CSS class name applied to badge and card styles */
    cssClass: string;
}

/**
 * Metadata descriptor for a day of the week.
 */
export interface DayMeta {
    /** Ukrainian short key used by Campus API (e.g. "Пн", "Вв") */
    key: string;
    /** Three-letter English code matching {@link DayCode} (e.g. "mon") */
    code: DayCode;
    /** Standard JavaScript Date day index (1 = Monday, ..., 6 = Saturday) */
    num: number;
    /** Localized full day name (e.g. "Понеділок") */
    fullName: string;
    /** Localized short abbreviation (e.g. "Пн") */
    shortName: string;
}

/**
 * Remote meeting link and credentials for an online lesson.
 */
export interface OnlineLink {
    /** Name of the subject or discipline */
    title: string;
    /** Lecturer surname and initials (optional for discipline-wide links) */
    lecturer?: string;
    /** Video conferencing URL (Zoom, Google Meet, Teams, etc.) */
    link: string;
    /** Meeting password or passcode (optional) */
    password?: string;
}

/**
 * Physical or digital location of a lesson (e.g. classroom number, building).
 */
export interface LessonLocation {
    /** Room or auditorium title (e.g. "ауд. 7-114", "спорт. зал") */
    title: string;
    /** Optional navigation URI or map link */
    uri?: string;
}

/**
 * Normalized representation of a single scheduled lesson instance.
 */
export interface Lesson {
    /** Type of lesson (Lecture, Practice, Lab, or Other) */
    type: LessonType;
    /** Full title of the discipline */
    title: string;
    /** Full name / surname of the lecturer */
    lecturer: string;
    /** Classroom or location metadata */
    location: LessonLocation | null;
    /** Video conferencing URL */
    link: string;
    /** Optional meeting password */
    password?: string;
}

/**
 * Map associating slot numbers with an array of lessons scheduled in that slot.
 */
export type DaySlotLessons = Partial<Record<SlotNumber, Lesson[]>>;

/**
 * Complete schedule structure for a single academic week, indexed by {@link DayCode}.
 */
export type WeekMap = Record<DayCode, DaySlotLessons>;

/**
 * Full bi-weekly academic schedule containing both odd (week 1) and even (week 2) weeks.
 */
export interface ScheduleData {
    /** Schedule for the odd / 1st academic week */
    week1: WeekMap;
    /** Schedule for the even / 2nd academic week */
    week2: WeekMap;
}

// ---------------------------------------------------------------------------
// KPI Campus API Interfaces
// ---------------------------------------------------------------------------

/**
 * Lecturer object as returned by the official KPI Campus Schedule API.
 */
export interface ApiLecturer {
    /** Unique campus identifier */
    id?: string;
    /** Full name of the lecturer */
    name: string;
}

/**
 * Raw pair object received from the KPI Campus Schedule API.
 */
export interface ApiPair {
    /** Subject name */
    name: string;
    /** Short type tag (e.g. "lec", "prac", "lab") */
    tag?: string;
    /** Localized type name (e.g. "Лек", "Прак", "Лаб") */
    type?: string;
    /** Start time string (e.g. "08:30" or "8:30:00") */
    time: string;
    /** Lecturer information */
    lecturer?: ApiLecturer;
    /** Auditorium or location metadata */
    location?: LessonLocation;
}

/**
 * Schedule container for a single day as returned by the KPI Campus API.
 */
export interface ApiDay {
    /** Localized Ukrainian day abbreviation (e.g. "Пн", "Вв", "Ср") */
    day: string;
    /** Array of scheduled pairs for this day */
    pairs: ApiPair[];
}

/**
 * Root response payload from the KPI Campus Schedule API endpoint.
 */
export interface ApiScheduleResponse {
    /** List of days and pairs for the first (odd) academic week */
    scheduleFirstWeek: ApiDay[];
    /** List of days and pairs for the second (even) academic week */
    scheduleSecondWeek: ApiDay[];
}

// ---------------------------------------------------------------------------
// Backend Backup Interfaces
// ---------------------------------------------------------------------------

/**
 * Metadata descriptor for a timestamped schedule backup file.
 */
export interface BackupInfo {
    /** Filename on server disk (e.g. "links_20260915_120000.json") */
    filename: string;
    /** Formatted human-readable creation timestamp (e.g. "15.09.2026 12:00:00") */
    createdAt: string;
    /** Backup file size in bytes */
    size: number;
}
