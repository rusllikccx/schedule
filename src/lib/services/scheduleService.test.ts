import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
    getCachedSchedule,
    setCachedSchedule,
    getScheduleUpdatedAt,
    loadCachedOnlineLinks,
    cacheOnlineLinks,
    getLinksUpdatedAt,
    applyLinksToSchedule
} from './scheduleService';
import { setActiveOnlineLinks } from './linkMatcher';
import { STORAGE_KEYS } from '../constants';
import { LessonType, type ScheduleData, type OnlineLink } from '../types';

class LocalStorageMock {
    private store: Record<string, string> = {};
    getItem(key: string) {
        return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null;
    }
    setItem(key: string, value: string) {
        this.store[key] = String(value);
    }
    removeItem(key: string) {
        delete this.store[key];
    }
    clear() {
        this.store = {};
    }
}

const mockLocalStorage = new LocalStorageMock();
const originalWindow = globalThis.window;
const originalLocalStorage = globalThis.localStorage;

describe('scheduleService module', () => {
    beforeEach(() => {
        mockLocalStorage.clear();
        globalThis.window = globalThis as unknown as Window & typeof globalThis;
        // @ts-expect-error Mocking localStorage
        globalThis.localStorage = mockLocalStorage;
    });

    afterAll(() => {
        globalThis.window = originalWindow;
        globalThis.localStorage = originalLocalStorage;
    });

    const mockSchedule: ScheduleData = {
        week1: {
            mon: {
                1: [
                    {
                        title: 'Вища математика',
                        type: LessonType.Lecture,
                        lecturer: 'Петренко П.П.',
                        link: '',
                        location: { title: '101' }
                    }
                ]
            },
            tue: {},
            wed: {},
            thu: {},
            fri: {},
            sat: {}
        },
        week2: {
            mon: {},
            tue: {
                2: [
                    {
                        title: 'Фізика',
                        type: LessonType.Lab,
                        lecturer: 'Сидоренко С.С.',
                        link: '',
                        location: { title: '202' }
                    }
                ]
            },
            wed: {},
            thu: {},
            fri: {},
            sat: {}
        }
    };

    describe('schedule caching', () => {
        it('returns null when no schedule is cached', () => {
            expect(getCachedSchedule()).toBeNull();
            expect(getScheduleUpdatedAt()).toBeNull();
        });

        it('persists and retrieves cached schedule and updates timestamp', () => {
            setCachedSchedule(mockSchedule);

            const cached = getCachedSchedule();
            expect(cached).toEqual(mockSchedule);

            const updatedAt = getScheduleUpdatedAt();
            expect(updatedAt).not.toBeNull();
            expect(typeof updatedAt).toBe('string');
        });
    });

    describe('online links caching', () => {
        it('loads default bundled links if storage is empty', () => {
            const links = loadCachedOnlineLinks();
            expect(Array.isArray(links)).toBe(true);
            expect(links.length).toBeGreaterThan(0);
        });

        it('saves and loads custom links from storage', () => {
            const customLinks: OnlineLink[] = [
                {
                    title: 'Вища математика',
                    lecturer: 'Петренко П.П.',
                    link: 'https://zoom.us/j/123456789',
                    password: 'math-pass-123'
                }
            ];

            cacheOnlineLinks(customLinks);

            const loaded = loadCachedOnlineLinks();
            expect(loaded).toEqual(customLinks);

            const updatedAt = getLinksUpdatedAt();
            expect(updatedAt).not.toBeNull();
        });
    });

    describe('applyLinksToSchedule', () => {
        it('injects matching meeting links and passwords into schedule lessons', () => {
            const activeLinks: OnlineLink[] = [
                {
                    title: 'Вища математика',
                    lecturer: 'Петренко',
                    link: 'https://zoom.us/j/math',
                    password: '123'
                },
                {
                    title: 'Фізика',
                    link: 'https://meet.google.com/phy-sics'
                }
            ];
            setActiveOnlineLinks(activeLinks);

            const updated = applyLinksToSchedule(mockSchedule);

            // Week 1, Monday, Slot 1
            const mathLesson = updated.week1.mon[1]?.[0];
            expect(mathLesson?.link).toBe('https://zoom.us/j/math?pwd=123');
            expect(mathLesson?.password).toBe('123');

            // Week 2, Tuesday, Slot 2
            const physicsLesson = updated.week2.tue[2]?.[0];
            expect(physicsLesson?.link).toBe('https://meet.google.com/phy-sics');
            expect(physicsLesson?.password).toBeUndefined();

            // Original schedule remains unmutated
            expect(mockSchedule.week1.mon[1]?.[0]?.link).toBe('');
        });

        it('handles days with empty slots safely', () => {
            setActiveOnlineLinks([]);
            const updated = applyLinksToSchedule(mockSchedule);

            expect(updated.week1.wed).toEqual({});
            expect(updated.week2.sat).toEqual({});
        });

        it('handles weeks with empty day keys and multiple lessons in slot', () => {
            const multiLessonSchedule: ScheduleData = {
                week1: {
                    mon: {
                        1: [
                            { title: 'Вища математика', type: LessonType.Lecture, lecturer: '', link: '', location: null },
                            { title: 'Фізика', type: LessonType.Lab, lecturer: '', link: '', location: null }
                        ]
                    },
                    tue: {}, wed: {}, thu: {}, fri: {}, sat: {}
                },
                week2: {
                    mon: {}, tue: {}, wed: {}, thu: {}, fri: {}, sat: {}
                }
            };

            const res = applyLinksToSchedule(multiLessonSchedule);
            expect(res.week1.mon[1]?.length).toBe(2);
        });
    });
});
