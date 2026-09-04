<script lang="ts">
    import { onMount } from 'svelte';
    import {
        TIME_SLOTS,
        DAYS,
        getActualCurrentWeek,
        createEmptyWeekMap,
        fetchSchedule,
        type ScheduleData
    } from '$lib/schedule';
    import LessonsCell from '$lib/components/LessonsCell.svelte';

    let displayedWeek = $state(1);
    let selectedMobileDay = $state(1);
    let loading = $state(true);
    let error = $state<string | null>(null);
    let currentTime = $state(new Date());

    let scheduleData = $state<ScheduleData>({
        week1: createEmptyWeekMap(),
        week2: createEmptyWeekMap()
    });

    let actualWeek = $derived(getActualCurrentWeek(currentTime));
    let isCurrentWeek = $derived(displayedWeek === actualWeek);
    let currentDay = $derived(currentTime.getDay());
    let currentMinutes = $derived(currentTime.getHours() * 60 + currentTime.getMinutes());

    let activeSlot = $derived.by(() => {
        if (!isCurrentWeek) return null;
        for (let i = 0; i < TIME_SLOTS.length; i++) {
            if (currentMinutes >= TIME_SLOTS[i].startMin && currentMinutes <= TIME_SLOTS[i].endMin) {
                return TIME_SLOTS[i].slot;
            }
        }
        return null;
    });

    let currentWeekData = $derived(displayedWeek === 1 ? scheduleData.week1 : scheduleData.week2);

    async function loadScheduleData() {
        loading = true;
        error = null;
        try {
            scheduleData = await fetchSchedule();
        } catch (err: unknown) {
            console.error('Failed to load schedule:', err);
            error = 'Не вдалося завантажити розклад з API';
        } finally {
            loading = false;
        }
    } 
    

    onMount(() => {
        const now = new Date();
        currentTime = now;
        displayedWeek = getActualCurrentWeek(now);
        selectedMobileDay = now.getDay() || 1;

        fetchSchedule();
        loadScheduleData();

        const timer = setInterval(() => {
            currentTime = new Date();
        }, 60000);

        return () => {
            clearInterval(timer);
        };
    });
</script>

<div class="container-fluid px-2 px-md-4">
    <header class="d-flex flex-column align-items-center mb-3">
        <h1 class="main-title fw-bold mb-3 text-center">Розклад занять</h1>

        <div class="btn-group shadow-sm mb-2" role="group" id="week-selector">
            <button
                type="button"
                class="btn btn-outline-primary px-3 px-md-4 py-2 fw-semibold"
                class:active={displayedWeek === 1}
                onclick={() => (displayedWeek = 1)}
            >
                Непарний
            </button>
            <button
                type="button"
                class="btn btn-outline-primary px-3 px-md-4 py-2 fw-semibold"
                class:active={displayedWeek === 2}
                onclick={() => (displayedWeek = 2)}
            >
                Парний
            </button>
        </div>

        <div
            class="btn-group w-100 shadow-sm d-md-none overflow-auto mt-1"
            role="group"
            id="mobile-day-buttons"
        >
            {#each DAYS as day}
                <button
                    type="button"
                    class="btn fw-semibold flex-fill"
                    class:btn-primary={selectedMobileDay === day.num}
                    class:active={selectedMobileDay === day.num}
                    class:btn-outline-secondary={selectedMobileDay !== day.num}
                    onclick={() => (selectedMobileDay = day.num)}
                >
                    {day.shortName}
                </button>
            {/each}
        </div>
    </header>

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
                                <td
                                    data-day={day.num}
                                    data-slot={slot.slot}
                                    class:current-day-cell={isCurrentWeek && currentDay === day.num}
                                    class:mobile-active-day={selectedMobileDay === day.num}
                                >
                                    <LessonsCell
                                        {lessons}
                                        isSlotActive={isCurrentWeek && currentDay === day.num && activeSlot === slot.slot}
                                        cellId="toggle-w{displayedWeek}-{day.num}-{slot.slot}"
                                    />
                                </td>
                            {/each}
                        </tr>
                    {/each}
                {/if}
            </tbody>
        </table>
    </main>
</div>
