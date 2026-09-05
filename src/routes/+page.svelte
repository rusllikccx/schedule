<script lang="ts">
    import { onMount } from 'svelte';
    import {
        TIME_SLOTS,
        DAYS,
        getActualCurrentWeek,
        createEmptyWeekMap,
        fetchSchedule,
        getCachedSchedule,
        loadCachedOnlineLinks,
        fetchServerOnlineLinks,
        applyLinksToSchedule,
        activeOnlineLinks,
        type ScheduleData,
        type OnlineLink
    } from '$lib/schedule';
    import {
        loadHiddenSubjects,
        saveHiddenSubjects,
        clearHiddenSubjects,
        loadShowHideControls,
        saveShowHideControls,
        getStoredAdminPassword
    } from '$lib/cookies';
    import LessonsCell from '$lib/components/LessonsCell.svelte';
    import EditLinksModal from '$lib/components/EditLinksModal.svelte';
    import TestTimePanel from '$lib/components/TestTimePanel.svelte';
    import { initDiagnostics } from '$lib/diagnostics';

    let displayedWeek = $state(1);
    let selectedMobileDay = $state(1);
    let loading = $state(true);
    let error = $state<string | null>(null);
    let currentTime = $state(new Date());
    let hiddenSubjects = $state<string[]>([]);
    let showRemoveControls = $state(false);

    // Test simulation mode state
    let isTestMode = $state(false);
    let testDate = $state(new Date());

    // Links editing state
    let isLinksModalOpen = $state(false);
    let currentLinks = $state<OnlineLink[]>([]);
    let adminPassword = $state('');

    let scheduleData = $state<ScheduleData>({
        week1: createEmptyWeekMap(),
        week2: createEmptyWeekMap()
    });

    // When test mode is active, use testDate instead of real currentTime
    let activeTime = $derived(isTestMode ? testDate : currentTime);

    let actualWeek = $derived(getActualCurrentWeek(activeTime));
    let isCurrentWeek = $derived(displayedWeek === actualWeek);
    let currentDay = $derived(activeTime.getDay());
    let currentMinutes = $derived(activeTime.getHours() * 60 + activeTime.getMinutes());

    let activeSlot = $derived.by(() => {
        if (!isCurrentWeek) return null;
        for (let i = 0; i < TIME_SLOTS.length; i++) {
            if (currentMinutes >= TIME_SLOTS[i].startMin && currentMinutes <= TIME_SLOTS[i].endMin) {
                return TIME_SLOTS[i].slot;
            }
        }
        return null;
    });

    let nextActiveSlot = $derived.by(() => {
        if (!isCurrentWeek) return null;
        const todayMeta = DAYS.find(d => d.num === currentDay);
        if (!todayMeta) return null;
        const todayWeekMap = displayedWeek === 1 ? scheduleData.week1 : scheduleData.week2;
        const rawTodaySlots = todayWeekMap[todayMeta.code] || {};

        for (const s of TIME_SLOTS) {
            // Check slots that start in the future
            if (currentMinutes < s.startMin) {
                const raw = rawTodaySlots[s.slot] || [];
                const filtered = hiddenSubjects.length > 0
                    ? raw.filter(l => !hiddenSubjects.includes(l.title))
                    : raw;
                if (filtered.length > 0) {
                    return s.slot;
                }
            }
        }
        return null;
    });

    let rawWeekData = $derived(displayedWeek === 1 ? scheduleData.week1 : scheduleData.week2);

    // In edit mode (showRemoveControls = true), display all subjects so hidden ones can be seen (as gray) and restored.
    // In normal mode, filter out hidden subjects completely.
    let currentWeekData = $derived.by(() => {
        if (showRemoveControls) {
            return rawWeekData;
        }
        const filtered: typeof rawWeekData = {};
        for (const dayCode of Object.keys(rawWeekData)) {
            filtered[dayCode] = {};
            for (const slotStr of Object.keys(rawWeekData[dayCode])) {
                const slotNum = Number(slotStr);
                const lessons = rawWeekData[dayCode][slotNum] || [];
                filtered[dayCode][slotNum] = hiddenSubjects.length > 0
                    ? lessons.filter(lesson => !hiddenSubjects.includes(lesson.title))
                    : lessons;
            }
        }
        return filtered;
    });

    // Compute live status, active pair, break, and progress slider for today
    let todayLiveStatus = $derived.by(() => {
        const todayMeta = DAYS.find(d => d.num === currentDay);
        if (!todayMeta) {
            return {
                mode: 'no-pairs' as const,
                title: 'Сьогодні вихідний',
                subtitle: '',
                passedPairs: 0,
                remainingPairs: 0,
                totalPairs: 0,
                percent: 0,
                color: 'gray' as const
            };
        }

        // Today's actual week map
        const todayWeekMap = actualWeek === 1 ? scheduleData.week1 : scheduleData.week2;
        const rawTodaySlots = todayWeekMap[todayMeta.code] || {};

        // Find pairs present today before vs after hidden filtering
        let totalActiveToday = 0;
        let slotsWithLessons: number[] = [];
        let slotLessonsFiltered: Record<number, typeof rawTodaySlots[number]> = {};
        let slotLessonsRaw: Record<number, typeof rawTodaySlots[number]> = {};

        for (const s of TIME_SLOTS) {
            const raw = rawTodaySlots[s.slot] || [];
            const filtered = hiddenSubjects.length > 0
                ? raw.filter(l => !hiddenSubjects.includes(l.title))
                : raw;
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
            const slot = TIME_SLOTS[currentSlotIndex];
            const filteredPairs = slotLessonsFiltered[slot.slot] || [];
            const rawPairs = slotLessonsRaw[slot.slot] || [];

            // How many active pairs have passed strictly before this slot
            const passed = slotsWithLessons.filter(sn => sn < slot.slot).length;
            const remaining = slotsWithLessons.filter(sn => sn > slot.slot).length;

            if (filteredPairs.length > 0) {
                // Active pair running right now!
                const pairNames = filteredPairs.map(p => p.title).join(' / ');
                const progressInSlot = Math.min(
                    100,
                    Math.max(0, ((currentMinutes - slot.startMin) / (slot.endMin - slot.startMin)) * 100)
                );
                const minutesLeft = slot.endMin - currentMinutes;

                return {
                    mode: 'active-pair' as const,
                    title: pairNames,
                    subtitle: `${slot.start} – ${slot.end} (залишилось ${minutesLeft} хв)`,
                    passedPairs: passed,
                    remainingPairs: remaining,
                    totalPairs: totalActiveToday,
                    percent: Math.round(progressInSlot),
                    color: 'green' as const
                };
            } else if (rawPairs.length > 0) {
                // User removed this pair
                const removedName = rawPairs.map(p => p.title).join(' / ');
                return {
                    mode: 'removed-pair' as const,
                    title: `${removedName} (приховано)`,
                    subtitle: `${slot.start} – ${slot.end}`,
                    passedPairs: passed,
                    remainingPairs: remaining,
                    totalPairs: totalActiveToday,
                    percent: 0,
                    color: 'gray' as const
                };
            } else {
                // Window/free slot
                return {
                    mode: 'no-pairs' as const,
                    title: 'Вільна пара (вікно)',
                    subtitle: `${slot.start} – ${slot.end}`,
                    passedPairs: passed,
                    remainingPairs: remaining,
                    totalPairs: totalActiveToday,
                    percent: 0,
                    color: 'gray' as const
                };
            }
        }

        // Check if currently inside a break between slots
        const firstSlot = TIME_SLOTS[0];
        const lastSlot = TIME_SLOTS[TIME_SLOTS.length - 1];

        if (currentMinutes > firstSlot.startMin && currentMinutes < lastSlot.endMin) {
            // Find the slot that just ended and the upcoming slot
            for (let i = 0; i < TIME_SLOTS.length - 1; i++) {
                const prev = TIME_SLOTS[i];
                const next = TIME_SLOTS[i + 1];
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

                    return {
                        mode: 'break' as const,
                        title: `Перерва перед: ${nextName}`,
                        subtitle: `Початок о ${next.start} (через ${breakLeft} хв)`,
                        passedPairs: passed,
                        remainingPairs: remaining,
                        totalPairs: totalActiveToday,
                        percent,
                        color: 'yellow' as const
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
                mode: 'break' as const,
                title: `До початку занять: ${firstName || 'Пара'}`,
                subtitle: `Початок о ${firstActiveSlot.start} (через ${minsToStart} хв)`,
                passedPairs: 0,
                remainingPairs: totalActiveToday,
                totalPairs: totalActiveToday,
                percent: 0,
                color: 'yellow' as const
            };
        }

        // After all classes ended or no classes today
        const hasPassedAll = currentMinutes > lastSlot.endMin || (slotsWithLessons.length > 0 && currentMinutes > (TIME_SLOTS.find(s => s.slot === slotsWithLessons[slotsWithLessons.length - 1])?.endMin ?? 0));

        return {
            mode: 'no-pairs' as const,
            title: totalActiveToday === 0 ? 'Сьогодні немає пар' : (hasPassedAll ? 'Всі пари на сьогодні завершено' : 'Немає пар'),
            subtitle: '',
            passedPairs: totalActiveToday,
            remainingPairs: 0,
            totalPairs: totalActiveToday,
            percent: 0,
            color: 'gray' as const
        };
    });

    function toggleRemoveControls() {
        showRemoveControls = !showRemoveControls;
        saveShowHideControls(showRemoveControls);
    }

    function hideSubject(subjectTitle: string) {
        if (!hiddenSubjects.includes(subjectTitle)) {
            hiddenSubjects = [...hiddenSubjects, subjectTitle];
            saveHiddenSubjects(hiddenSubjects);
        }
    }

    function unhideSubject(subjectTitle: string) {
        hiddenSubjects = hiddenSubjects.filter(s => s !== subjectTitle);
        saveHiddenSubjects(hiddenSubjects);
    }

    function resetHiddenSubjects() {
        hiddenSubjects = [];
        clearHiddenSubjects();
    }

    async function loadScheduleData() {
        // Step 1: Immediate instant load from persistent cache (renders in 0ms)
        const cached = getCachedSchedule();
        if (cached) {
            scheduleData = cached;
            loading = false;
        } else {
            loading = true;
        }
        error = null;

        // Step 2: Fetch fresh data from API
        try {
            const fresh = await fetchSchedule();
            // Deep compare with existing schedule to only trigger re-render and cache update when changed
            const currentJson = JSON.stringify(scheduleData);
            const freshJson = JSON.stringify(fresh);
            if (currentJson !== freshJson) {
                scheduleData = fresh;
            }
        } catch (err: unknown) {
            console.error('Failed to load schedule:', err);
            // If offline or API fails, keep showing cached schedule; only show error if no cache exists
            if (!cached) {
                error = 'Не вдалося завантажити розклад з API';
            }
        } finally {
            loading = false;
        }
    }

    function handleToggleTestMode(enabled: boolean) {
        isTestMode = enabled;
        if (enabled) {
            testDate = new Date(currentTime);
            displayedWeek = getActualCurrentWeek(testDate);
            const d = testDate.getDay();
            selectedMobileDay = d === 0 ? 1 : d;
        } else {
            displayedWeek = getActualCurrentWeek(currentTime);
            const d = currentTime.getDay();
            selectedMobileDay = d === 0 ? 1 : d;
        }
    }

    function handleSetTestDate(newDate: Date) {
        testDate = newDate;
        displayedWeek = getActualCurrentWeek(newDate);
        const d = newDate.getDay();
        selectedMobileDay = d === 0 ? 1 : d;
    }

    function handleResetToRealTime() {
        const now = new Date();
        currentTime = now;
        testDate = new Date(now);
        displayedWeek = getActualCurrentWeek(now);
        const d = now.getDay();
        selectedMobileDay = d === 0 ? 1 : d;
    }

    function handleSaveLinksSuccess(updatedLinks: OnlineLink[], pwd: string) {
        currentLinks = updatedLinks;
        adminPassword = pwd;
        // Re-apply updated links to current scheduleData so UI reflects new links instantly
        scheduleData = applyLinksToSchedule(scheduleData);
    }

    onMount(() => {
        const now = new Date();
        currentTime = now;
        displayedWeek = getActualCurrentWeek(now);
        const dayOfWeek = now.getDay();
        selectedMobileDay = dayOfWeek === 0 ? 1 : dayOfWeek;
        hiddenSubjects = loadHiddenSubjects();
        showRemoveControls = loadShowHideControls();
        adminPassword = getStoredAdminPassword();

        // 1. Load links from local cache or JSON fallback
        currentLinks = loadCachedOnlineLinks();

        // 2. Load schedule
        loadScheduleData();

        // 3. Fetch latest server links in background and re-apply if updated
        fetchServerOnlineLinks().then(serverLinks => {
            if (serverLinks) {
                currentLinks = serverLinks;
                scheduleData = applyLinksToSchedule(scheduleData);
            }
        });

        // 4. Initialize zero-overhead background diagnostics in console
        initDiagnostics(() => ({
            hiddenSubjectsCount: hiddenSubjects.length,
            linksCount: currentLinks.length
        }));

        const timer = setInterval(() => {
            currentTime = new Date();
        }, 10000);

        return () => {
            clearInterval(timer);
        };
    });
</script>

<div class="container-fluid px-2 px-md-4">
    <header class="d-flex flex-column align-items-center mb-3">
        <h1 class="main-title fw-bold mb-2 text-center">Розклад занять</h1>

        <!-- Time & Day Simulation Test Panel -->
        <div class="w-100 mb-2">
            <TestTimePanel
                {isTestMode}
                {testDate}
                onToggleTestMode={handleToggleTestMode}
                onSetTestDate={handleSetTestDate}
                onResetToRealTime={handleResetToRealTime}
            />
        </div>

        <div class="header-toolbar w-100 mb-2">
            <div class="header-left-actions d-flex align-items-center gap-2">
                <button
                    type="button"
                    id="toggle-remove-btn"
                    class="btn btn-sm px-3 py-2 fw-semibold shadow-sm"
                    class:btn-outline-secondary={!showRemoveControls}
                    class:btn-danger={showRemoveControls}
                    onclick={toggleRemoveControls}
                    title={showRemoveControls ? 'Приховати хрестики видалення' : 'Показати хрестики для приховування занять'}
                >
                    {showRemoveControls ? '✕ Вимкнути видалення' : '✎ Редагувати розклад'}
                </button>

                {#if showRemoveControls && hiddenSubjects.length > 0}
                    <button
                        type="button"
                        id="reset-hidden-btn"
                        class="btn btn-outline-danger btn-sm px-2 px-md-3 py-2 fw-semibold shadow-sm"
                        onclick={resetHiddenSubjects}
                        title="Повернути всі приховані заняття ({hiddenSubjects.length})"
                    >
                        <span class="d-none d-md-inline">Повернути приховані ({hiddenSubjects.length})</span>
                        <span class="d-inline d-md-none">↺</span>
                    </button>
                {/if}

                {#if showRemoveControls}
                    <button
                        type="button"
                        id="edit-links-btn"
                        class="btn btn-outline-primary btn-sm px-2 px-md-3 py-2 fw-semibold shadow-sm"
                        onclick={() => (isLinksModalOpen = true)}
                        title="Редагувати посилання на онлайн-пари"
                    >
                        <span class="d-none d-md-inline">🔗 Посилання</span>
                        <span class="d-inline d-md-none">🔗</span>
                    </button>
                {/if}
            </div>

            <div class="header-center-actions d-flex justify-content-center">
                <div class="btn-group shadow-sm" role="group" id="week-selector">
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
            </div>

            <div class="header-right-action">
                <!-- Live Status & Progress Slider (compact) -->
                <div class="live-status-card status-{todayLiveStatus.color}">
                    <div class="d-flex justify-content-between align-items-center gap-2 mb-1">
                        <div class="d-flex align-items-center gap-1 text-truncate">
                            <span class="status-indicator"></span>
                            <span class="status-title fw-bold text-truncate">{todayLiveStatus.title}</span>
                        </div>
                        <div class="status-stats text-muted small text-nowrap">
                            <span class="badge-count">Пройшло: <strong>{todayLiveStatus.passedPairs}</strong></span>
                            <span class="mx-1">•</span>
                            <span class="badge-count">Залишилось: <strong>{todayLiveStatus.remainingPairs}</strong></span>
                        </div>
                    </div>

                    {#if todayLiveStatus.subtitle}
                        <div class="status-time text-muted small text-truncate mb-1">{todayLiveStatus.subtitle}</div>
                    {/if}

                    <div class="live-progress-track" role="progressbar" aria-valuenow={todayLiveStatus.percent} aria-valuemin="0" aria-valuemax="100">
                        <div
                            class="live-progress-bar progress-{todayLiveStatus.color}"
                            style="width: {todayLiveStatus.percent}%;"
                        ></div>
                    </div>
                </div>
            </div>
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
                                {@const isTodayCell = isCurrentWeek && currentDay === day.num}
                                {@const slotStatus = isTodayCell
                                    ? (activeSlot === slot.slot
                                        ? 'current'
                                        : (nextActiveSlot === slot.slot
                                            ? 'next'
                                            : (currentMinutes > slot.endMin ? 'ended' : null)))
                                    : null}
                                <td
                                    data-day={day.num}
                                    data-slot={slot.slot}
                                    class:current-day-cell={isTodayCell}
                                    class:mobile-active-day={selectedMobileDay === day.num}
                                >
                                    <LessonsCell
                                        {lessons}
                                        isSlotActive={isTodayCell && activeSlot === slot.slot}
                                        lessonStatus={slotStatus}
                                        cellId="toggle-w{displayedWeek}-{day.num}-{slot.slot}"
                                        {showRemoveControls}
                                        {hiddenSubjects}
                                        onHideSubject={hideSubject}
                                        onUnhideSubject={unhideSubject}
                                    />
                                </td>
                            {/each}
                        </tr>
                    {/each}
                {/if}
            </tbody>
        </table>
    </main>

    <EditLinksModal
        isOpen={isLinksModalOpen}
        links={currentLinks}
        {scheduleData}
        initialPassword={adminPassword}
        onClose={() => (isLinksModalOpen = false)}
        onSaveSuccess={handleSaveLinksSuccess}
    />
</div>
