import { LessonType, type TimeSlot, type LessonTypeInfo, type DayMeta } from './types';

export const API_URL = 'https://api.campus.kpi.ua/schedule/lessons?groupId=5598';

export const TIME_SLOTS: TimeSlot[] = [
    { slot: 1, start: '08:30', end: '10:05', startMin: 510, endMin: 605 },
    { slot: 2, start: '10:25', end: '12:00', startMin: 625, endMin: 720 },
    { slot: 3, start: '12:20', end: '13:55', startMin: 740, endMin: 835 },
    { slot: 4, start: '14:15', end: '15:50', startMin: 855, endMin: 950 },
    { slot: 5, start: '16:10', end: '17:45', startMin: 970, endMin: 1065 },
    { slot: 6, start: '18:05', end: '19:40', startMin: 1085, endMin: 1180 }
];

export const TIME_TO_SLOT: Readonly<Record<string, number>> = {
    '08:30': 1,
    '8:30': 1,
    '10:25': 2,
    '12:20': 3,
    '14:15': 4,
    '16:10': 5,
    '18:05': 6
};

export const LESSON_TYPES: Record<LessonType, LessonTypeInfo> = {
    [LessonType.Lecture]: { name: 'Лекція', cssClass: 'type-lecture' },
    [LessonType.Practice]: { name: 'Практика', cssClass: 'type-practice' },
    [LessonType.Lab]: { name: 'Лабораторна', cssClass: 'type-lab' },
    [LessonType.Other]: { name: 'Заняття', cssClass: 'type-other' }
};

export const DAYS: DayMeta[] = [
    { key: 'Пн', code: 'mon', num: 1, fullName: 'Понеділок', shortName: 'Пн' },
    { key: 'Вв', code: 'tue', num: 2, fullName: 'Вівторок', shortName: 'Вт' },
    { key: 'Ср', code: 'wed', num: 3, fullName: 'Середа', shortName: 'Ср' },
    { key: 'Чт', code: 'thu', num: 4, fullName: 'Четвер', shortName: 'Чт' },
    { key: 'Пт', code: 'fri', num: 5, fullName: "П'ятниця", shortName: 'Пт' },
    { key: 'Сб', code: 'sat', num: 6, fullName: 'Субота', shortName: 'Сб' }
];
