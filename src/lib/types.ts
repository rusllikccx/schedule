export enum LessonType {
    Lecture = 1,
    Practice = 2,
    Lab = 3,
    Other = 4
}

export interface TimeSlot {
    slot: number;
    start: string;
    end: string;
    startMin: number;
    endMin: number;
}

export interface LessonTypeInfo {
    name: string;
    cssClass: string;
}

export interface DayMeta {
    key: string;
    code: string;
    num: number;
    fullName: string;
    shortName: string;
}

export interface OnlineLink {
    title: string;
    lecturer?: string;
    link: string;
}

export interface LessonLocation {
    title: string;
    uri?: string;
}

export interface Lesson {
    type: LessonType;
    title: string;
    lecturer: string;
    location: LessonLocation | null;
    link: string;
}

export type DaySlotLessons = Record<number, Lesson[]>;
export type WeekMap = Record<string, DaySlotLessons>;

export interface ScheduleData {
    week1: WeekMap;
    week2: WeekMap;
}

// KPI Campus API interfaces
export interface ApiLecturer {
    id?: string;
    name: string;
}

export interface ApiPair {
    name: string;
    tag?: string;
    type?: string;
    time: string;
    lecturer?: ApiLecturer;
    location?: LessonLocation;
}

export interface ApiDay {
    day: string;
    pairs: ApiPair[];
}

export interface ApiScheduleResponse {
    scheduleFirstWeek: ApiDay[];
    scheduleSecondWeek: ApiDay[];
}
