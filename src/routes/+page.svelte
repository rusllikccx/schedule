<script lang="ts">
    import { onMount } from 'svelte';
    import { replaceState } from '$app/navigation';
    import { TIME_SLOTS, DAYS } from '$lib/constants';
    import type { ScheduleData, OnlineLink } from '$lib/types';
    import { getActualCurrentWeek } from '$lib/utils/calendar';
    import { createEmptyWeekMap } from '$lib/utils/transformers';
    import { fetchSchedule, fetchServerOnlineLinks } from '$lib/services/api';
    import {
        getCachedSchedule,
        loadCachedOnlineLinks,
        applyLinksToSchedule
    } from '$lib/services/scheduleService';
    import {
        loadHiddenSubjects,
        saveHiddenSubjects,
        clearHiddenSubjects,
        loadShowHideControls,
        saveShowHideControls
    } from '$lib/storage';
    import ScheduleHeader from '$lib/components/ScheduleHeader.svelte';
    import ScheduleTable from '$lib/components/ScheduleTable.svelte';
    import EditLinksModal from '$lib/components/EditLinksModal.svelte';
    import TestTimePanel from '$lib/components/TestTimePanel.svelte';
    import { initDiagnostics } from '$lib/diagnostics';
    import { computeTodayLiveStatus } from '$lib/liveStatus';

    let displayedWeek = $state(1);
    let selectedMobileDay = $state(1);
    let loading = $state(true);
    let error = $state<string | null>(null);
    let currentTime = $state(new Date());
    let hiddenSubjects = $state<string[]>([]);
    let showRemoveControls = $state(false);

    // Reactive Set for O(1) membership checks
    let hiddenSubjectsSet = $derived(new Set(hiddenSubjects));

    // Test simulation mode state
    let isTestMode = $state(false);
    let testDate = $state(new Date());

    // Links editing state
    let isLinksModalOpen = $state(false);
    let currentLinks = $state<OnlineLink[]>([]);

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
            const s = TIME_SLOTS[i]!;
            if (currentMinutes >= s.startMin && currentMinutes <= s.endMin) {
                return s.slot;
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
            if (currentMinutes < s.startMin) {
                const raw = rawTodaySlots[s.slot] || [];
                const filtered = hiddenSubjects.length > 0
                    ? raw.filter(l => !hiddenSubjectsSet.has(l.title))
                    : raw;
                if (filtered.length > 0) {
                    return s.slot;
                }
            }
        }
        return null;
    });

    let rawWeekData = $derived(displayedWeek === 1 ? scheduleData.week1 : scheduleData.week2);

    let currentWeekData = $derived.by(() => {
        if (showRemoveControls) {
            return rawWeekData;
        }
        const filtered: typeof rawWeekData = createEmptyWeekMap();
        for (const day of DAYS) {
            const dayCode = day.code;
            const rawSlots = rawWeekData[dayCode] || {};
            filtered[dayCode] = {};
            for (const s of TIME_SLOTS) {
                const lessons = rawSlots[s.slot] || [];
                filtered[dayCode][s.slot] = hiddenSubjects.length > 0
                    ? lessons.filter(lesson => !hiddenSubjectsSet.has(lesson.title))
                    : lessons;
            }
        }
        return filtered;
    });

    let todayLiveStatus = $derived(
        computeTodayLiveStatus({
            currentDay,
            currentMinutes,
            actualWeek,
            scheduleData,
            hiddenSubjectsSet
        })
    );

    function toggleRemoveControls() {
        showRemoveControls = !showRemoveControls;
        saveShowHideControls(showRemoveControls);
    }

    function hideSubject(subjectTitle: string) {
        if (!hiddenSubjectsSet.has(subjectTitle)) {
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
        const cached = getCachedSchedule();
        if (cached) {
            scheduleData = cached;
            loading = false;
        } else {
            loading = true;
        }
        error = null;

        try {
            const fresh = await fetchSchedule();
            const currentJson = JSON.stringify(scheduleData);
            const freshJson = JSON.stringify(fresh);
            if (currentJson !== freshJson) {
                scheduleData = fresh;
            }
        } catch (err: unknown) {
            console.error('Failed to load schedule:', err);
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

            if (typeof window !== 'undefined' && !window.location.search.includes('test')) {
                const url = new URL(window.location.href);
                url.searchParams.set('test', '');
                const cleanQuery = url.searchParams.toString().replace(/test=(&|$)/, 'test$1');
                const target = url.pathname + (cleanQuery ? `?${cleanQuery}` : '') + url.hash;
                replaceState(target, {});
            }
        } else {
            displayedWeek = getActualCurrentWeek(currentTime);
            const d = currentTime.getDay();
            selectedMobileDay = d === 0 ? 1 : d;

            if (typeof window !== 'undefined' && window.location.search.includes('test')) {
                const url = new URL(window.location.href);
                url.searchParams.delete('test');
                const newQuery = url.searchParams.toString();
                const target = url.pathname + (newQuery ? `?${newQuery}` : '') + url.hash;
                replaceState(target, {});
            }
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

    function handleSaveLinksSuccess(updatedLinks: OnlineLink[]) {
        currentLinks = updatedLinks;
        scheduleData = applyLinksToSchedule(scheduleData);
    }

    let toastMessage = $state<string | null>(null);
    let toastTimeout: ReturnType<typeof setTimeout> | null = null;

    function showToast(message: string, duration = 3000) {
        toastMessage = message;
        if (toastTimeout) clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => {
            toastMessage = null;
        }, duration);
    }

    let highlightedCellKey = $state<string | null>(null);
    let highlightTimeout: ReturnType<typeof setTimeout> | null = null;

    function scrollToAndHighlightLesson(week: number, day: number, slot: number) {
        const key = `cell-w${week}-${day}-${slot}`;
        highlightedCellKey = key;
        if (highlightTimeout) clearTimeout(highlightTimeout);
        highlightTimeout = setTimeout(() => {
            highlightedCellKey = null;
        }, 2500);
    }

    function handleLiveStatusClick() {
        const status = todayLiveStatus;

        if (status.targetSlot && status.targetDay) {
            if (displayedWeek !== actualWeek) {
                displayedWeek = actualWeek;
            }
            if (status.targetDay >= 1 && status.targetDay <= 6) {
                selectedMobileDay = status.targetDay;
            }
            scrollToAndHighlightLesson(actualWeek, status.targetDay, status.targetSlot);
            return;
        }

        if (status.noLessonsReason === 'all-finished') {
            showToast('Всі пари на сьогодні завершено');
        } else {
            showToast('Сьогодні немає пар');
        }
    }

    onMount(() => {
        const now = new Date();
        currentTime = now;
        displayedWeek = getActualCurrentWeek(now);
        const dayOfWeek = now.getDay();
        selectedMobileDay = dayOfWeek === 0 ? 1 : dayOfWeek;
        hiddenSubjects = loadHiddenSubjects();
        showRemoveControls = loadShowHideControls();

        currentLinks = loadCachedOnlineLinks();
        void loadScheduleData();

        void fetchServerOnlineLinks().then(serverLinks => {
            if (serverLinks) {
                currentLinks = serverLinks;
                scheduleData = applyLinksToSchedule(scheduleData);
            }
        });

        initDiagnostics(() => ({
            hiddenSubjectsCount: hiddenSubjects.length,
            linksCount: currentLinks.length
        }));

        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('test')) {
            handleToggleTestMode(true);
        }

        window.__toggleTestMode = (forced?: boolean) => {
            const next = typeof forced === 'boolean' ? forced : !isTestMode;
            handleToggleTestMode(next);
            console.log(`[Schedule] Режим тестування: ${next ? 'УВІМКНЕНО' : 'ВИМКНЕНО'}`);
        };

        const timer = setInterval(() => {
            currentTime = new Date();
        }, 10000);

        return () => {
            clearInterval(timer);
            delete window.__toggleTestMode;
        };
    });
</script>

<div class="container-fluid px-2 px-md-4">
    {#if isTestMode}
        <div class="w-100 mb-2">
            <TestTimePanel
                {isTestMode}
                {testDate}
                onToggleTestMode={handleToggleTestMode}
                onSetTestDate={handleSetTestDate}
                onResetToRealTime={handleResetToRealTime}
            />
        </div>
    {/if}

    <ScheduleHeader
        {displayedWeek}
        {selectedMobileDay}
        {showRemoveControls}
        hiddenCount={hiddenSubjects.length}
        {todayLiveStatus}
        onToggleWeek={(w) => (displayedWeek = w)}
        onSelectMobileDay={(d) => (selectedMobileDay = d)}
        onToggleRemoveControls={toggleRemoveControls}
        onResetHidden={resetHiddenSubjects}
        onOpenLinksModal={() => (isLinksModalOpen = true)}
        onLiveStatusClick={handleLiveStatusClick}
    />

    <ScheduleTable
        {loading}
        {error}
        {displayedWeek}
        {isCurrentWeek}
        {currentDay}
        {currentMinutes}
        {activeSlot}
        {nextActiveSlot}
        {selectedMobileDay}
        {currentWeekData}
        {highlightedCellKey}
        {showRemoveControls}
        {hiddenSubjects}
        {hiddenSubjectsSet}
        onHideSubject={hideSubject}
        onUnhideSubject={unhideSubject}
    />

    <EditLinksModal
        isOpen={isLinksModalOpen}
        links={currentLinks}
        {scheduleData}
        onClose={() => (isLinksModalOpen = false)}
        onSaveSuccess={handleSaveLinksSuccess}
    />

    {#if toastMessage}
        <div class="schedule-toast-container" role="status" aria-live="polite">
            <div class="schedule-toast shadow-lg">
                <span class="schedule-toast-icon">ℹ️</span>
                <span class="schedule-toast-text">{toastMessage}</span>
            </div>
        </div>
    {/if}
</div>
