<script lang="ts">
    import { DAYS, TIME_SLOTS } from '$lib/constants';
    import { getActualCurrentWeek } from '$lib/utils/calendar';

    interface Props {
        isTestMode: boolean;
        testDate: Date;
        onToggleTestMode: (enabled: boolean) => void;
        onSetTestDate: (date: Date) => void;
        onResetToRealTime: () => void;
    }

    let {
        isTestMode = false,
        testDate,
        onToggleTestMode,
        onSetTestDate,
        onResetToRealTime
    }: Props = $props();

    let isExpanded = $state(true);

    // Format helpers
    function pad(n: number) {
        return String(n).padStart(2, '0');
    }

    let timeString = $derived(
        `${pad(testDate.getHours())}:${pad(testDate.getMinutes())}`
    );

    let currentDayNum = $derived(testDate.getDay());
    let currentWeekNum = $derived(getActualCurrentWeek(testDate));

    function handleDayChange(e: Event) {
        const target = e.target as HTMLSelectElement;
        const targetDay = Number(target.value);
        const newDate = new Date(testDate);
        const currentD = newDate.getDay();
        const diff = targetDay - currentD;
        newDate.setDate(newDate.getDate() + diff);
        onSetTestDate(newDate);
    }

    function handleTimeChange(e: Event) {
        const target = e.target as HTMLInputElement;
        const parts = target.value.split(':').map(Number);
        const h = parts[0];
        const m = parts[1];
        if (h !== undefined && m !== undefined && !isNaN(h) && !isNaN(m)) {
            const newDate = new Date(testDate);
            newDate.setHours(h, m, 0, 0);
            onSetTestDate(newDate);
        }
    }

    function handleWeekToggle(week: number) {
        if (currentWeekNum !== week) {
            const newDate = new Date(testDate);
            newDate.setDate(newDate.getDate() + 7);
            onSetTestDate(newDate);
        }
    }

    function setSlotTime(slotNum: number, position: 'start' | 'middle' | 'end' | 'break') {
        const slot = TIME_SLOTS.find(s => s.slot === slotNum);
        if (!slot) return;
        const newDate = new Date(testDate);

        if (position === 'start') {
            newDate.setHours(Math.floor(slot.startMin / 60), slot.startMin % 60 + 2, 0, 0);
        } else if (position === 'middle') {
            const mid = Math.floor((slot.startMin + slot.endMin) / 2);
            newDate.setHours(Math.floor(mid / 60), mid % 60, 0, 0);
        } else if (position === 'end') {
            newDate.setHours(Math.floor(slot.endMin / 60), slot.endMin % 60 - 5, 0, 0);
        } else if (position === 'break') {
            // 5 mins after slot ends
            const after = slot.endMin + 5;
            newDate.setHours(Math.floor(after / 60), after % 60, 0, 0);
        }
        onSetTestDate(newDate);
    }
</script>

<div class="test-panel-wrapper shadow-sm" class:is-active={isTestMode}>
    <div class="test-panel-header d-flex align-items-center justify-content-between">
        <div class="d-flex align-items-center gap-2">
            <span class="test-badge">🧪 Тест-режим</span>
            {#if isTestMode}
            <span class="test-current-label text-truncate">
                    {DAYS.find(d => d.num === currentDayNum)?.shortName || 'Нд'}, {timeString} ({currentWeekNum === 1 ? 'Непарний' : 'Парний'})
                </span>
                <button
                    type="button"
                    class="btn btn-sm btn-outline-danger py-0 px-2 test-btn-sm"
                    onclick={() => onToggleTestMode(false)}
                    title="Вимкнути тест-режим та закрити вікно"
                >
                    ✕ Вийти
                </button>
                
            {/if}
        </div>

        <div class="d-flex align-items-center gap-1">
            {#if isTestMode}
                <button
                    type="button"
                    class="btn btn-sm btn-outline-secondary py-0 px-2 test-btn-sm"
                    onclick={onResetToRealTime}
                    title="Скинути до реального поточного часу"
                >
                    Реальний час
                </button>
            {/if}
            <button
                type="button"
                class="btn btn-sm btn-light py-0 px-2 test-toggle-btn"
                onclick={() => (isExpanded = !isExpanded)}
                title={isExpanded ? 'Згорнути панель' : 'Розгорнути налаштування тесту'}
            >
                {isExpanded ? '▲' : '▼'}
            </button>
        </div>
    </div>

    {#if isExpanded}
        <div class="test-panel-body p-2 border-top">
            <!-- Row 1: Day, Time and Week selectors -->
            <div class="row g-2 align-items-center mb-2">
                <div class="col-6 col-sm-4">
                    <label for="test-day-select" class="form-label small fw-semibold mb-1">День тижня:</label>
                    <select
                        id="test-day-select"
                        class="form-select form-select-sm"
                        value={currentDayNum}
                        onchange={handleDayChange}
                        disabled={!isTestMode}
                    >
                        {#each DAYS as day}
                            <option value={day.num}>{day.fullName}</option>
                        {/each}
                        <option value={0}>Неділя (Вихідний)</option>
                    </select>
                </div>

                <div class="col-6 col-sm-4">
                    <label for="test-time-input" class="form-label small fw-semibold mb-1">Час:</label>
                    <input
                        type="time"
                        id="test-time-input"
                        class="form-control form-control-sm"
                        value={timeString}
                        onchange={handleTimeChange}
                        disabled={!isTestMode}
                    />
                </div>

                <div class="col-12 col-sm-4">
                    <span class="form-label small fw-semibold mb-1 d-block">Тиждень:</span>
                    <div class="btn-group btn-group-sm w-100" role="group">
                        <button
                            type="button"
                            class="btn"
                            class:btn-primary={currentWeekNum === 1}
                            class:btn-outline-secondary={currentWeekNum !== 1}
                            onclick={() => handleWeekToggle(1)}
                            disabled={!isTestMode}
                        >
                            1 (Непарн.)
                        </button>
                        <button
                            type="button"
                            class="btn"
                            class:btn-primary={currentWeekNum === 2}
                            class:btn-outline-secondary={currentWeekNum !== 2}
                            onclick={() => handleWeekToggle(2)}
                            disabled={!isTestMode}
                        >
                            2 (Парн.)
                        </button>
                    </div>
                </div>
            </div>

            <!-- Row 2: Quick Jump Presets for lessons and breaks -->
            {#if isTestMode}
                <div class="quick-presets mt-2">
                    <div class="small text-muted fw-semibold mb-1">Швидкі пресети пар:</div>
                    <div class="d-flex flex-wrap gap-1">
                        {#each TIME_SLOTS as slot}
                            <div class="btn-group btn-group-sm mb-1" role="group">
                                <button
                                    type="button"
                                    class="btn btn-outline-secondary py-0 px-2"
                                    title="Поставити час усередині {slot.slot}-ї пари ({slot.start} - {slot.end})"
                                    onclick={() => setSlotTime(slot.slot, 'middle')}
                                >
                                    {slot.slot} пара
                                </button>
                                <button
                                    type="button"
                                    class="btn btn-outline-warning text-dark py-0 px-1"
                                    title="Перерва після {slot.slot}-ї пари"
                                    onclick={() => setSlotTime(slot.slot, 'break')}
                                >
                                    Перерва
                                </button>
                            </div>
                        {/each}
                    </div>
                </div>
            {/if}
        </div>
    {/if}
</div>

<style>
    .test-panel-wrapper {
        background-color: #ffffff;
        border: 1px dashed #cbd5e1;
        border-radius: 8px;
        padding: 6px 12px;
        margin-bottom: 12px;
        transition: all 0.2s ease;
    }

    .test-panel-wrapper.is-active {
        background-color: #fefce8;
        border: 1px solid #facc15;
        box-shadow: 0 2px 10px rgba(234, 179, 8, 0.15) !important;
    }

    .test-badge {
        font-size: 0.78rem;
        font-weight: 700;
        color: #475569;
        letter-spacing: -0.01em;
    }

    .test-panel-wrapper.is-active .test-badge {
        color: #854d0e;
    }

    .test-current-label {
        font-size: 0.8rem;
        font-weight: 600;
        color: #854d0e;
        background-color: #fef08a;
        padding: 2px 8px;
        border-radius: 4px;
    }

    .test-btn-sm {
        font-size: 0.72rem;
        padding-top: 1px !important;
        padding-bottom: 1px !important;
    }

    .test-toggle-btn {
        font-size: 0.75rem;
        color: #64748b;
        border: 1px solid #e2e8f0;
    }

    .test-panel-body {
        background-color: transparent;
        padding-top: 8px !important;
    }

    .quick-presets .btn {
        font-size: 0.72rem;
    }
</style>

