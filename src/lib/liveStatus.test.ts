import { describe, it, expect } from 'vitest';
import { computeTodayLiveStatus } from './liveStatus';
import { createEmptyWeekMap } from './utils/transformers';
import { LessonType, type ScheduleData } from './types';

describe('Live Status: computeTodayLiveStatus', () => {
    const mockSchedule: ScheduleData = {
        week1: {
            ...createEmptyWeekMap(),
            mon: {
                1: [
                    {
                        type: LessonType.Lecture,
                        title: 'Основи захисту інформації',
                        lecturer: 'Новіков О.М.',
                        location: null,
                        link: 'https://zoom.us/j/1'
                    }
                ],
                3: [
                    {
                        type: LessonType.Practice,
                        title: 'Архітектура комп’ютерних систем',
                        lecturer: 'Гальчинський Л.Ю.',
                        location: null,
                        link: 'https://zoom.us/j/2'
                    }
                ]
            },
            sat: {}
        },
        week2: createEmptyWeekMap()
    };

    it('returns "no-pairs" on Sunday', () => {
        const status = computeTodayLiveStatus({
            currentDay: 0, // Sunday
            currentMinutes: 600,
            actualWeek: 1,
            scheduleData: mockSchedule
        });

        expect(status.mode).toBe('no-pairs');
        expect(status.title).toBe('Сьогодні вихідний');
        expect(status.color).toBe('gray');
    });

    it('returns "no-pairs" on Saturday with no lessons after hours', () => {
        const status = computeTodayLiveStatus({
            currentDay: 6, // Saturday
            currentMinutes: 1200, // 20:00
            actualWeek: 1,
            scheduleData: mockSchedule
        });

        expect(status.mode).toBe('no-pairs');
        expect(status.title).toBe('Сьогодні немає пар');
        expect(status.noLessonsReason).toBe('no-lessons-today');
    });

    it('handles before classes start in the morning', () => {
        const status = computeTodayLiveStatus({
            currentDay: 1, // Monday
            currentMinutes: 480, // 08:00 (before 08:30)
            actualWeek: 1,
            scheduleData: mockSchedule
        });

        expect(status.mode).toBe('break');
        expect(status.title).toContain('До початку занять');
        expect(status.targetSlot).toBe(1);
    });

    it('identifies active pair during slot 1 (08:30 - 10:05)', () => {
        const status = computeTodayLiveStatus({
            currentDay: 1, // Monday
            currentMinutes: 540, // 09:00
            actualWeek: 1,
            scheduleData: mockSchedule
        });

        expect(status.mode).toBe('active-pair');
        expect(status.title).toBe('Основи захисту інформації');
        expect(status.targetSlot).toBe(1);
        expect(status.color).toBe('green');
    });

    it('identifies removed / hidden pair during active slot', () => {
        const status = computeTodayLiveStatus({
            currentDay: 1, // Monday
            currentMinutes: 540, // 09:00
            actualWeek: 1,
            scheduleData: mockSchedule,
            hiddenSubjects: ['Основи захисту інформації']
        });

        expect(status.mode).toBe('removed-pair');
        expect(status.title).toContain('(приховано)');
    });

    it('identifies window / free slot during slot 2 (10:25 - 12:00)', () => {
        const status = computeTodayLiveStatus({
            currentDay: 1, // Monday
            currentMinutes: 660, // 11:00
            actualWeek: 1,
            scheduleData: mockSchedule
        });

        expect(status.mode).toBe('no-pairs');
        expect(status.title).toBe('Вільна пара (вікно)');
        expect(status.targetSlot).toBe(3);
    });

    it('identifies break between slot 1 and slot 2 (10:05 - 10:25)', () => {
        const status = computeTodayLiveStatus({
            currentDay: 1, // Monday
            currentMinutes: 615, // 10:15
            actualWeek: 1,
            scheduleData: mockSchedule
        });

        expect(status.mode).toBe('break');
        expect(status.title).toContain('Перерва перед: Вільна пара');
        expect(status.color).toBe('yellow');
    });

    it('identifies break before hidden lesson', () => {
        const status = computeTodayLiveStatus({
            currentDay: 1, // Monday
            currentMinutes: 730, // 12:10 (break before slot 3: 12:20)
            actualWeek: 1,
            scheduleData: mockSchedule,
            hiddenSubjectsSet: new Set(['Архітектура комп’ютерних систем'])
        });

        expect(status.mode).toBe('break');
        expect(status.title).toContain('(приховано)');
    });

    it('identifies break before multi-lesson slot (subgroups)', () => {
        const multiSchedule: ScheduleData = {
            week1: {
                ...createEmptyWeekMap(),
                mon: {
                    1: [{ type: LessonType.Lecture, title: 'Пара 1', lecturer: '', location: null, link: '' }],
                    2: [
                        { type: LessonType.Lab, title: 'Лаба 1', lecturer: '', location: null, link: '' },
                        { type: LessonType.Lab, title: 'Лаба 2', lecturer: '', location: null, link: '' }
                    ]
                }
            },
            week2: createEmptyWeekMap()
        };

        const status = computeTodayLiveStatus({
            currentDay: 1,
            currentMinutes: 615,
            actualWeek: 1,
            scheduleData: multiSchedule
        });

        expect(status.mode).toBe('break');
        expect(status.title).toBe('Перерва перед: Лаба 1 / Лаба 2');
    });

    it('identifies all finished after all pairs ended', () => {
        const status = computeTodayLiveStatus({
            currentDay: 1, // Monday
            currentMinutes: 1200, // 20:00
            actualWeek: 1,
            scheduleData: mockSchedule
        });

        expect(status.mode).toBe('no-pairs');
        expect(status.noLessonsReason).toBe('all-finished');
        expect(status.title).toBe('Всі пари на сьогодні завершено');
    });
});
