/**
 * @fileoverview Pure domain logic for calculating real-time academic status.
 *
 * Computes:
 * - Active pair in progress (title, minutes remaining, progress bar percentage).
 * - Break between pairs (next upcoming lesson, countdown in minutes, break progress percentage).
 * - Removed / hidden lessons status in edit mode.
 * - End of day / weekend status.
 */

import { DAYS, TIME_SLOTS } from './constants';
import type { ScheduleData, Lesson, SlotNumber } from './types';

/**
 * Operating mode describing the current real-time situation.
 */
export type LiveStatusMode =
    | 'active-pair'     // An active pair is currently ongoing
    | 'break'           // Currently in a break between pairs or before the first pair
    | 'no-pairs'        // No pairs scheduled, weekend, or all pairs finished
    | 'removed-pair';   // The current time slot contains a lesson that the user explicitly hid

/**
 * Visual indicator color for the status widget and progress bar.
 */
export type LiveStatusColor = 'green' | 'yellow' | 'gray';

/**
 * Detailed categorization when no active lessons are in progress.
 */
export type NoLessonsReason = 'no-lessons-today' | 'all-finished' | null;

/**
 * Computed state model for the live status header widget.
 */
export interface LiveStatus {
    /** Current operating state mode */
    mode: LiveStatusMode;
    /** Primary status headline (e.g. subject name or "Всі пари на сьогодні завершено") */
    title: string;
    /** Secondary detail line with time range and remaining minutes */
    subtitle: string;
    /** Number of active pairs completed earlier today */
    passedPairs: number;
    /** Number of active pairs remaining after the current slot/break */
    remainingPairs: number;
    /** Total count of active (non-hidden) pairs scheduled for today */
    totalPairs: number;
    /** Progress bar fill percentage (0 to 100) */
    percent: number;
    /** Status theme color ('green', 'yellow', or 'gray') */
    color: LiveStatusColor;
    /** Target slot number to scroll to when the user clicks the status widget */
    targetSlot: SlotNumber | null;
    /** Day index of the target lesson (1..6) */
    targetDay: number | null;
    /** Specific reason if no lessons are ongoing */
    noLessonsReason: NoLessonsReason;
}

/**
 * Parameters required to compute the live status.
 */
export interface ComputeLiveStatusOptions {
    /** JavaScript day of week (0 = Sunday, 1 = Monday, ..., 6 = Saturday) */
    currentDay: number;
    /** Total minutes elapsed from midnight (e.g. `hours * 60 + minutes`) */
    currentMinutes: number;
    /** Active academic week number (1 = odd, 2 = even) */
    actualWeek: number;
    /** Full bi-weekly schedule data */
    scheduleData: ScheduleData;
    /** Set of subject titles hidden by user for $O(1)$ fast lookup */
    hiddenSubjectsSet?: ReadonlySet<string>;
    /** Fallback array of hidden subject titles */
    hiddenSubjects?: string[];
}

/**
 * Pure calculation function that evaluates the live status, active/next pair,
 * breaks, and day progress bar according to the current timestamp and schedule.
 *
 * @param options - Contextual time and schedule options.
 * @returns Fully computed {@link LiveStatus} state object.
 *
 * @example
 * ```ts
 * const status = computeTodayLiveStatus({
 *     currentDay: 2, // Tuesday
 *     currentMinutes: 540, // 09:00
 *     actualWeek: 1,
 *     scheduleData
 * });
 * console.log(status.title, status.percent);
 * ```
 */
export function computeTodayLiveStatus({
    currentDay,
    currentMinutes,
    actualWeek,
    scheduleData,
    hiddenSubjectsSet,
    hiddenSubjects
}: ComputeLiveStatusOptions): LiveStatus {
    const todayMeta = DAYS.find(d => d.num === currentDay);
    if (!todayMeta) {
        return {
            mode: 'no-pairs',
            title: 'Сьогодні вихідний',
            subtitle: '',
            passedPairs: 0,
            remainingPairs: 0,
            totalPairs: 0,
            percent: 0,
            color: 'gray',
            targetSlot: null,
            targetDay: null,
            noLessonsReason: 'no-lessons-today'
        };
    }

    // Fast O(1) set lookup for hidden subjects
    const isHidden = (title: string): boolean => {
        if (hiddenSubjectsSet) {
            return hiddenSubjectsSet.has(title);
        }
        if (hiddenSubjects && hiddenSubjects.length > 0) {
            return hiddenSubjects.includes(title);
        }
        return false;
    };

    // Today's actual week map
    const todayWeekMap = actualWeek === 1 ? scheduleData.week1 : scheduleData.week2;
    const rawTodaySlots = todayWeekMap[todayMeta.code] || {};

    // Find pairs present today before vs after hidden filtering
    let totalActiveToday = 0;
    const slotsWithLessons: SlotNumber[] = [];
    const slotLessonsFiltered: Partial<Record<SlotNumber, Lesson[]>> = {};
    const slotLessonsRaw: Partial<Record<SlotNumber, Lesson[]>> = {};

    for (const s of TIME_SLOTS) {
        const raw = rawTodaySlots[s.slot] || [];
        const filtered = raw.filter(l => !isHidden(l.title));
        slotLessonsRaw[s.slot] = raw;
        slotLessonsFiltered[s.slot] = filtered;

        if (filtered.length > 0) {
            totalActiveToday++;
            slotsWithLessons.push(s.slot);
        }
    }

    // Check if currently inside a pair slot
    const currentSlotIndex = TIME_SLOTS.findIndex(
        s => currentMinutes >= s.startMin && currentMinutes <= s.endMin
    );

    if (currentSlotIndex !== -1) {
        const slot = TIME_SLOTS[currentSlotIndex]!;
        const filteredPairs = slotLessonsFiltered[slot.slot] || [];
        const rawPairs = slotLessonsRaw[slot.slot] || [];

        // How many active pairs have passed strictly before this slot
        const passed = slotsWithLessons.filter(sn => sn < slot.slot).length;
        const remaining = slotsWithLessons.filter(sn => sn > slot.slot).length;

        if (filteredPairs.length > 0) {
            // Active pair running right now
            const pairNames = filteredPairs.map(p => p.title).join(' / ');
            const progressInSlot = Math.min(
                100,
                Math.max(0, ((currentMinutes - slot.startMin) / (slot.endMin - slot.startMin)) * 100)
            );
            const minutesLeft = slot.endMin - currentMinutes;

            return {
                mode: 'active-pair',
                title: pairNames,
                subtitle: `${slot.start} – ${slot.end} (залишилось ${minutesLeft} хв)`,
                passedPairs: passed,
                remainingPairs: remaining,
                totalPairs: totalActiveToday,
                percent: Math.round(progressInSlot),
                color: 'green',
                targetSlot: slot.slot,
                targetDay: currentDay,
                noLessonsReason: null
            };
        } else if (rawPairs.length > 0) {
            // User removed this pair
            const removedName = rawPairs.map(p => p.title).join(' / ');
            return {
                mode: 'removed-pair',
                title: `${removedName} (приховано)`,
                subtitle: `${slot.start} – ${slot.end}`,
                passedPairs: passed,
                remainingPairs: remaining,
                totalPairs: totalActiveToday,
                percent: 0,
                color: 'gray',
                targetSlot: slot.slot,
                targetDay: currentDay,
                noLessonsReason: null
            };
        } else {
            // Window/free slot
            const nextUpcomingSlot = slotsWithLessons.find(sn => sn > slot.slot) ?? null;
            return {
                mode: 'no-pairs',
                title: 'Вільна пара (вікно)',
                subtitle: `${slot.start} – ${slot.end}`,
                passedPairs: passed,
                remainingPairs: remaining,
                totalPairs: totalActiveToday,
                percent: 0,
                color: 'gray',
                targetSlot: nextUpcomingSlot,
                targetDay: nextUpcomingSlot ? currentDay : null,
                noLessonsReason: nextUpcomingSlot ? null : 'all-finished'
            };
        }
    }

    // Check if currently inside a break between slots
    const firstSlot = TIME_SLOTS[0]!;
    const lastSlot = TIME_SLOTS[TIME_SLOTS.length - 1]!;

    if (currentMinutes > firstSlot.startMin && currentMinutes < lastSlot.endMin) {
        // Find the slot that just ended and the upcoming slot
        for (let i = 0; i < TIME_SLOTS.length - 1; i++) {
            const prev = TIME_SLOTS[i]!;
            const next = TIME_SLOTS[i + 1]!;
            if (currentMinutes > prev.endMin && currentMinutes < next.startMin) {
                const nextFiltered = slotLessonsFiltered[next.slot] || [];
                const nextRaw = slotLessonsRaw[next.slot] || [];
                const nextName = nextFiltered.length > 0
                    ? nextFiltered.map(p => p.title).join(' / ')
                    : (nextRaw.length > 0 ? `${nextRaw.map(p => p.title).join(' / ')} (приховано)` : 'Вільна пара');

                const passed = slotsWithLessons.filter(sn => sn <= prev.slot).length;
                const remaining = slotsWithLessons.filter(sn => sn >= next.slot).length;
                const breakDuration = next.startMin - prev.endMin;
                const breakElapsed = currentMinutes - prev.endMin;
                const breakLeft = next.startMin - currentMinutes;
                const percent = Math.min(100, Math.max(0, Math.round((breakElapsed / breakDuration) * 100)));
                const nextActive = slotsWithLessons.find(sn => sn >= next.slot) || next.slot;

                return {
                    mode: 'break',
                    title: `Перерва перед: ${nextName}`,
                    subtitle: `Початок о ${next.start} (через ${breakLeft} хв)`,
                    passedPairs: passed,
                    remainingPairs: remaining,
                    totalPairs: totalActiveToday,
                    percent,
                    color: 'yellow',
                    targetSlot: nextActive,
                    targetDay: currentDay,
                    noLessonsReason: null
                };
            }
        }
    }

    // Before classes start
    if (currentMinutes < firstSlot.startMin && totalActiveToday > 0) {
        const firstActiveSlotNum = slotsWithLessons[0];
        const firstActiveSlot = TIME_SLOTS.find(s => s.slot === firstActiveSlotNum) || firstSlot;
        const firstName = (slotLessonsFiltered[firstActiveSlot.slot] || []).map(p => p.title).join(' / ');
        const minsToStart = firstActiveSlot.startMin - currentMinutes;

        return {
            mode: 'break',
            title: `До початку занять: ${firstName || 'Пара'}`,
            subtitle: `Початок о ${firstActiveSlot.start} (через ${minsToStart} хв)`,
            passedPairs: 0,
            remainingPairs: totalActiveToday,
            totalPairs: totalActiveToday,
            percent: 0,
            color: 'yellow',
            targetSlot: firstActiveSlot.slot,
            targetDay: currentDay,
            noLessonsReason: null
        };
    }

    // After all classes ended or no classes today
    const lastActiveSlotNum = slotsWithLessons[slotsWithLessons.length - 1];
    const lastActiveEndMin = lastActiveSlotNum
        ? (TIME_SLOTS.find(s => s.slot === lastActiveSlotNum)?.endMin ?? 0)
        : 0;

    const hasPassedAll = currentMinutes > lastSlot.endMin || (slotsWithLessons.length > 0 && currentMinutes > lastActiveEndMin);

    return {
        mode: 'no-pairs',
        title: totalActiveToday === 0 ? 'Сьогодні немає пар' : (hasPassedAll ? 'Всі пари на сьогодні завершено' : 'Немає пар'),
        subtitle: '',
        passedPairs: totalActiveToday,
        remainingPairs: 0,
        totalPairs: totalActiveToday,
        percent: 0,
        color: 'gray',
        targetSlot: null,
        targetDay: null,
        noLessonsReason: totalActiveToday === 0 ? 'no-lessons-today' : 'all-finished'
    };
}
