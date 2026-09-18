import { describe, it, expect } from 'vitest';
import { getActualCurrentWeek } from './calendar';

describe('Academic Calendar: getActualCurrentWeek', () => {
    const semStart = new Date(2026, 8, 1); // 1 Sep 2026 (Tuesday) -> aligns to Monday 31 Aug

    it('identifies the first week of semester as odd (1)', () => {
        const week1Date = new Date(2026, 8, 2); // 2 Sep 2026
        expect(getActualCurrentWeek(week1Date, semStart)).toBe(1);
    });

    it('identifies the second week of semester as even (2)', () => {
        const week2Date = new Date(2026, 8, 9); // 9 Sep 2026
        expect(getActualCurrentWeek(week2Date, semStart)).toBe(2);
    });

    it('identifies the third week of semester as odd (1)', () => {
        const week3Date = new Date(2026, 8, 16); // 16 Sep 2026
        expect(getActualCurrentWeek(week3Date, semStart)).toBe(1);
    });

    it('correctly calculates week parity for Sunday', () => {
        const sundayWeek1 = new Date(2026, 8, 6); // Sunday of week 1
        expect(getActualCurrentWeek(sundayWeek1, semStart)).toBe(1);
    });

    it('handles semester start date on a Sunday', () => {
        const sundayStart = new Date(2026, 7, 30); // 30 Aug 2026 (Sunday) -> aligns to Monday 24 Aug
        const dateWeek1 = new Date(2026, 7, 31); // 31 Aug 2026 (Monday) -> week 2
        expect(getActualCurrentWeek(dateWeek1, sundayStart)).toBe(2);
    });

    it('works with default parameters', () => {
        const week = getActualCurrentWeek();
        expect([1, 2]).toContain(week);
    });
});
