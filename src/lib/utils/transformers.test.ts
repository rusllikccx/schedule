import { describe, it, expect } from 'vitest';
import { parseType, getSlotByTime, createEmptyWeekMap, transformWeekData } from './transformers';
import { LessonType, type ApiDay } from '../types';

describe('Transformers: parseType', () => {
    it('maps "lec" tag to LessonType.Lecture', () => {
        expect(parseType('lec')).toBe(LessonType.Lecture);
        expect(parseType(undefined, 'Лек')).toBe(LessonType.Lecture);
    });

    it('maps "prac" tag to LessonType.Practice', () => {
        expect(parseType('prac')).toBe(LessonType.Practice);
        expect(parseType(undefined, 'Прак')).toBe(LessonType.Practice);
    });

    it('maps "lab" tag to LessonType.Lab', () => {
        expect(parseType('lab')).toBe(LessonType.Lab);
        expect(parseType(undefined, 'Лаб')).toBe(LessonType.Lab);
    });

    it('defaults unknown types to LessonType.Other', () => {
        expect(parseType('unknown')).toBe(LessonType.Other);
        expect(parseType(undefined, 'Іспит')).toBe(LessonType.Other);
        expect(parseType()).toBe(LessonType.Other);
    });
});

describe('Transformers: getSlotByTime', () => {
    it('returns 1 for 08:30 and 8:30 and 08:30:00', () => {
        expect(getSlotByTime('08:30')).toBe(1);
        expect(getSlotByTime('8:30')).toBe(1);
        expect(getSlotByTime('08:30:00')).toBe(1);
    });

    it('returns 2 for 10:25 and 10:25:00', () => {
        expect(getSlotByTime('10:25')).toBe(2);
        expect(getSlotByTime('10:25:00')).toBe(2);
    });

    it('returns 3 for 12:20', () => {
        expect(getSlotByTime('12:20')).toBe(3);
    });

    it('returns 4 for 14:15', () => {
        expect(getSlotByTime('14:15')).toBe(4);
    });

    it('returns 5 for 16:10', () => {
        expect(getSlotByTime('16:10')).toBe(5);
    });

    it('returns 6 for 18:05', () => {
        expect(getSlotByTime('18:05')).toBe(6);
    });

    it('falls back to 1 for unmapped or empty times', () => {
        expect(getSlotByTime('23:59')).toBe(1);
        expect(getSlotByTime('')).toBe(1);
    });
});

describe('Transformers: transformWeekData', () => {
    it('creates all 6 day keys for an empty week', () => {
        const week = createEmptyWeekMap();
        expect(Object.keys(week)).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
    });

    it('handles null and undefined apiDays safely', () => {
        expect(transformWeekData(null)).toEqual(createEmptyWeekMap());
        expect(transformWeekData(undefined)).toEqual(createEmptyWeekMap());
    });

    it('transforms valid API response into structured WeekMap', () => {
        const apiDays: ApiDay[] = [
            {
                day: 'Пн',
                pairs: [
                    {
                        name: 'Вища математика',
                        time: '08:30',
                        tag: 'lec',
                        lecturer: { name: 'Петренко П.П.' },
                        location: { title: '101' }
                    }
                ]
            },
            {
                day: 'Нд', // Non-standard day (Sunday), should be ignored
                pairs: [
                    {
                        name: 'Факультатив',
                        time: '10:25'
                    }
                ]
            },
            {
                day: 'Вв',
                pairs: [
                    {
                        name: 'Фізика',
                        time: '10:25',
                        tag: 'lab'
                    }
                ]
            }
        ];

        const result = transformWeekData(apiDays);
        expect(result.mon[1]).toBeDefined();
        expect(result.mon[1]!.length).toBe(1);
        expect(result.mon[1]![0]!.title).toBe('Вища математика');
        expect(result.mon[1]![0]!.type).toBe(LessonType.Lecture);
        expect(result.mon[1]![0]!.lecturer).toBe('Петренко П.П.');
        expect(result.mon[1]![0]!.location).toEqual({ title: '101' });

        expect(result.tue[2]).toBeDefined();
        expect(result.tue[2]![0]!.lecturer).toBe('');
        expect(result.tue[2]![0]!.location).toBeNull();
    });
});
