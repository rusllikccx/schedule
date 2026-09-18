<script lang="ts">
    import { LESSON_TYPES } from '$lib/constants';
    import { LessonType, type Lesson } from '$lib/types';

    interface Props {
        lesson: Lesson;
        isActive?: boolean;
        status?: 'current' | 'next' | 'ended' | null;
        showRemoveControls?: boolean;
        isHidden?: boolean;
        onHide?: (title: string) => void;
        onUnhide?: (title: string) => void;
    }

    let {
        lesson,
        isActive = false,
        status = null,
        showRemoveControls = false,
        isHidden = false,
        onHide,
        onUnhide
    }: Props = $props();

    let typeInfo = $derived(LESSON_TYPES[lesson.type] || LESSON_TYPES[LessonType.Other]);

    let isCopied = $state(false);
    let copyTimeout: ReturnType<typeof setTimeout> | null = null;

    async function handleCopyPassword(e: MouseEvent) {
        e.preventDefault();
        e.stopPropagation();
        if (!lesson.password) return;

        try {
            await navigator.clipboard.writeText(lesson.password);
            isCopied = true;
            if (copyTimeout) clearTimeout(copyTimeout);
            copyTimeout = setTimeout(() => {
                isCopied = false;
            }, 2000);
        } catch (err) {
            console.error('Failed to copy password:', err);
        }
    }

    function handleToggle(e: MouseEvent) {
        e.preventDefault();
        e.stopPropagation();
        if (isHidden) {
            onUnhide?.(lesson.title);
        } else {
            onHide?.(lesson.title);
        }
    }

    function handleCardClick(e: MouseEvent) {
        if (!lesson.link || showRemoveControls) return;
        window.open(lesson.link, '_blank', 'noopener,noreferrer');
    }

    function handleCardKeyDown(e: KeyboardEvent) {
        if (!lesson.link || showRemoveControls) return;
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            window.open(lesson.link, '_blank', 'noopener,noreferrer');
        }
    }
</script>

{#snippet cardContent()}
    <div>
        <div class="lesson-header-row">
            <div class="d-flex align-items-center gap-1 flex-wrap">
                <span class="badge-type">{typeInfo.name}</span>
                {#if status && !isHidden}
                    <span class="badge-status badge-status-{status}">
                        {#if status === 'current'}
                            Іде зараз
                        {:else if status === 'next'}
                            Наступна
                        {:else if status === 'ended'}
                            Закінчилась
                        {/if}
                    </span>
                {/if}
            </div>
            {#if showRemoveControls}
                <button
                    type="button"
                    class="hide-subject-btn"
                    class:restore-subject-btn={isHidden}
                    onclick={handleToggle}
                    title={isHidden ? 'Відновити дисципліну' : 'Приховати дисципліну'}
                    aria-label={isHidden ? 'Відновити дисципліну' : 'Приховати дисципліну'}
                >
                    {isHidden ? '↩' : '✕'}
                </button>
            {/if}
        </div>
        <div class="lesson-title">{lesson.title}</div>
    </div>
    <div class="lesson-footer">
        {#if lesson.lecturer}
            <div class="lesson-lecturer">{lesson.lecturer}</div>
        {/if}
        {#if lesson.location}
            {#if lesson.location.uri}
                <div class="mt-1">
                    📍 
                    <a
                        href={lesson.location.uri}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="location-link"
                        onclick={(e) => e.stopPropagation()}
                        title="Відкрити карту корпусу ({lesson.location.title})"
                    >
                        ауд. {lesson.location.title}
                    </a>
                </div>
            {:else}
                <div class="location-text mt-1 text-muted">
                    📍 ауд. {lesson.location.title}
                </div>
            {/if}
        {/if}
        {#if lesson.password}
            <div class="lesson-password-row mt-1">
                <div class="lesson-password-wrapper">
                    <button
                        type="button"
                        class="lesson-password-btn"
                        class:copied={isCopied}
                        onclick={handleCopyPassword}
                        aria-label="Скопіювати пароль до пари ({lesson.password})"
                    >
                        {#if isCopied}
                            <span class="password-copied-text">✓ Скопійовано!</span>
                        {:else}
                            <span class="password-icon">🔑</span>
                            <span class="password-value">{lesson.password}</span>
                        {/if}
                    </button>
                    {#if !isCopied}
                        <div class="password-tooltip" role="tooltip">
                            Натисніть, щоб скопіювати пароль
                        </div>
                    {/if}
                </div>
            </div>
        {/if}
    </div>
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
    class="lesson-card {typeInfo.cssClass}"
    class:current-lesson-active={isActive}
    class:is-hidden={isHidden}
    class:has-link={!!lesson.link && !showRemoveControls}
    role={lesson.link && !showRemoveControls ? 'link' : undefined}
    tabindex={lesson.link && !showRemoveControls ? 0 : undefined}
    onclick={handleCardClick}
    onkeydown={handleCardKeyDown}
>
    {@render cardContent()}
</div>

