/**
 * @fileoverview Academic calendar and week parity calculation utilities.
 */

/**
 * Calculates the active academic week (1 = odd/непарний, 2 = even/парний).
 *
 * The calculation aligns both the target date and the semester start date to Monday 00:00:00
 * to guarantee that every day within the same Monday-Sunday block has the exact same parity.
 *
 * @param date - The target date to check (defaults to the current timestamp).
 * @param semesterStart - Reference start date of the semester (defaults to September 1, 2026).
 * @returns `1` for odd week (1-й тиждень), `2` for even week (2-й тиждень).
 *
 * @example
 * ```ts
 * const currentWeek = getActualCurrentWeek(new Date());
 * console.log(currentWeek === 1 ? 'Непарний' : 'Парний');
 * ```
 */
export function getActualCurrentWeek(
    date: Date = new Date(),
    semesterStart: Date = new Date(2026, 8, 1)
): 1 | 2 {
    const startDay = new Date(date);
    const day = startDay.getDay();
    // Align to Monday of current week (Sunday is treated as day 7 of previous week)
    startDay.setDate(startDay.getDate() + ((day === 0 ? -6 : 1) - day));
    startDay.setHours(0, 0, 0, 0);

    const semStartMonday = new Date(semesterStart);
    const semDay = semStartMonday.getDay();
    semStartMonday.setDate(semStartMonday.getDate() + ((semDay === 0 ? -6 : 1) - semDay));
    semStartMonday.setHours(0, 0, 0, 0);

    // Number of 7-day week intervals between semester start Monday and current Monday
    const diffWeeks = Math.round((startDay.getTime() - semStartMonday.getTime()) / 604800000);
    return Math.abs(diffWeeks) % 2 === 0 ? 1 : 2;
}
