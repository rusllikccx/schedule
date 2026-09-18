<script lang="ts">
    import { TIME_SLOTS, DAYS } from '$lib/constants';
    import type { WeekMap } from '$lib/types';
    import LessonsCell from './LessonsCell.svelte';

    interface Props {
        loading: boolean;
        error: string | null;
        displayedWeek: number;
        isCurrentWeek: boolean;
        currentDay: number;
        currentMinutes: number;
        activeSlot: number | null;
        nextActiveSlot: number | null;
        selectedMobileDay: number;
        currentWeekData: WeekMap;
        highlightedCellKey: string | null;
        showRemoveControls: boolean;
        hiddenSubjects: string[];
        hiddenSubjectsSet: ReadonlySet<string>;
        onHideSubject: (title: string) => void;
        onUnhideSubject: (title: string) => void;
    }

    let {
        loading,
        error,
        displayedWeek,
        isCurrentWeek,
        currentDay,
        currentMinutes,
        activeSlot,
        nextActiveSlot,
        selectedMobileDay,
        currentWeekData,
        highlightedCellKey,
        showRemoveControls,
        hiddenSubjects,
        hiddenSubjectsSet,
        onHideSubject,
        onUnhideSubject
    }: Props = $props();

    function scrollOnHighlight(node: HTMLElement, isTarget: boolean) {
        if (isTarget) {
            setTimeout(() => {
                node.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
            }, 30);
        }
        return {
            update(newIsTarget: boolean) {
                if (newIsTarget) {
                    setTimeout(() => {
                        node.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
                    }, 30);
                }
            }
        };
    }
</script>

<main class="table-responsive">
    <table class="table schedule-table">
        <thead>
            <tr>
                <th class="time-col">Час</th>
                {#each DAYS as day}
                    <th
                        data-day={day.num}
                        class:current-day-header={isCurrentWeek && currentDay === day.num}
                        class:mobile-active-day={selectedMobileDay === day.num}
                    >
                        {day.fullName}
                    </th>
                {/each}
            </tr>
        </thead>
        <tbody id="schedule-body">
            {#if loading}
                <tr>
                    <td colspan="7" class="text-center py-4 text-muted">
                        Завантаження розкладу...
                    </td>
                </tr>
            {:else if error}
                <tr>
                    <td colspan="7" class="text-center py-4 text-danger">
                        {error}
                    </td>
                </tr>
            {:else}
                {#each TIME_SLOTS as slot}
                    <tr>
                        <td class="time-col">
                            {slot.start}<br /><small class="text-muted">{slot.end}</small>
                        </td>
                        {#each DAYS as day}
                            {@const lessons = currentWeekData[day.code]?.[slot.slot] || []}
                            {@const isTodayCell = isCurrentWeek && currentDay === day.num}
                            {@const slotStatus = isTodayCell
                                ? (activeSlot === slot.slot
                                    ? 'current'
                                    : (nextActiveSlot === slot.slot
                                        ? 'next'
                                        : (currentMinutes > slot.endMin ? 'ended' : null)))
                                : null}
                            {@const cellKey = `cell-w${displayedWeek}-${day.num}-${slot.slot}`}
                            {@const isHighlighted = highlightedCellKey === cellKey}
                            <td
                                id={cellKey}
                                data-day={day.num}
                                data-slot={slot.slot}
                                class:current-day-cell={isTodayCell}
                                class:mobile-active-day={selectedMobileDay === day.num}
                                class:highlight-pointed-lesson={isHighlighted}
                                use:scrollOnHighlight={isHighlighted}
                            >
                                <LessonsCell
                                    {lessons}
                                    isSlotActive={isTodayCell && activeSlot === slot.slot}
                                    lessonStatus={slotStatus}
                                    cellId="toggle-w{displayedWeek}-{day.num}-{slot.slot}"
                                    {showRemoveControls}
                                    {hiddenSubjects}
                                    {hiddenSubjectsSet}
                                    onHideSubject={onHideSubject}
                                    onUnhideSubject={onUnhideSubject}
                                />
                            </td>
                        {/each}
                    </tr>
                {/each}
            {/if}
        </tbody>
    </table>
</main>

