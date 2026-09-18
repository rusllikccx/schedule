<script lang="ts">
    import { DAYS } from '$lib/constants';
    import type { LiveStatus } from '$lib/liveStatus';

    interface Props {
        displayedWeek: number;
        selectedMobileDay: number;
        showRemoveControls: boolean;
        hiddenCount: number;
        todayLiveStatus: LiveStatus;
        onToggleWeek: (week: number) => void;
        onSelectMobileDay: (day: number) => void;
        onToggleRemoveControls: () => void;
        onResetHidden: () => void;
        onOpenLinksModal: () => void;
        onLiveStatusClick: () => void;
    }

    let {
        displayedWeek,
        selectedMobileDay,
        showRemoveControls,
        hiddenCount,
        todayLiveStatus,
        onToggleWeek,
        onSelectMobileDay,
        onToggleRemoveControls,
        onResetHidden,
        onOpenLinksModal,
        onLiveStatusClick
    }: Props = $props();
</script>

<header class="d-flex flex-column align-items-center mb-3">
    <h1 class="main-title fw-bold mb-2 text-center">Розклад занять</h1>

    <div class="header-toolbar w-100 mb-2">
        <div class="header-left-actions d-flex align-items-center gap-2">
            <button
                type="button"
                id="toggle-remove-btn"
                class="btn btn-sm px-3 py-2 fw-semibold shadow-sm"
                class:btn-outline-secondary={!showRemoveControls}
                class:btn-danger={showRemoveControls}
                onclick={onToggleRemoveControls}
                title={showRemoveControls ? 'Приховати хрестики видалення' : 'Показати хрестики для приховування занять'}
            >
                {showRemoveControls ? '✕ Вимкнути видалення' : '✎ Редагувати розклад'}
            </button>

            {#if showRemoveControls && hiddenCount > 0}
                <button
                    type="button"
                    id="reset-hidden-btn"
                    class="btn btn-outline-danger btn-sm px-2 px-md-3 py-2 fw-semibold shadow-sm"
                    onclick={onResetHidden}
                    title="Повернути всі приховані заняття ({hiddenCount})"
                >
                    <span class="d-none d-md-inline">Повернути приховані ({hiddenCount})</span>
                    <span class="d-inline d-md-none">↺</span>
                </button>
            {/if}

            {#if showRemoveControls}
                <button
                    type="button"
                    id="edit-links-btn"
                    class="btn btn-outline-primary btn-sm px-2 px-md-3 py-2 fw-semibold shadow-sm"
                    onclick={onOpenLinksModal}
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
                    onclick={() => onToggleWeek(1)}
                >
                    Непарний
                </button>
                <button
                    type="button"
                    class="btn btn-outline-primary px-3 px-md-4 py-2 fw-semibold"
                    class:active={displayedWeek === 2}
                    onclick={() => onToggleWeek(2)}
                >
                    Парний
                </button>
            </div>
        </div>

        <div class="header-right-action">
            <!-- Live Status & Progress Slider (clickable) -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
                class="live-status-card status-{todayLiveStatus.color}"
                role="button"
                tabindex="0"
                onclick={onLiveStatusClick}
                onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onLiveStatusClick(); } }}
                title={todayLiveStatus.targetSlot
                    ? (todayLiveStatus.mode === 'active-pair' ? 'Натисніть, щоб перейти до поточної пари' : 'Натисніть, щоб перейти до наступної пари')
                    : (todayLiveStatus.noLessonsReason === 'all-finished' ? 'Всі пари на сьогодні завершено' : 'Сьогодні немає пар')}
            >
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
                onclick={() => onSelectMobileDay(day.num)}
            >
                {day.shortName}
            </button>
        {/each}
    </div>
</header>

