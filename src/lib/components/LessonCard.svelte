<script lang="ts">
    import { LESSON_TYPES, LessonType, type Lesson } from '$lib/schedule';

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

    function handleToggle(e: MouseEvent) {
        e.preventDefault();
        e.stopPropagation();
        if (isHidden) {
            onUnhide?.(lesson.title);
        } else {
            onHide?.(lesson.title);
        }
    }
</script>

{#snippet cardContent()}
    <div style="position: relative;">
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
        <div class="lesson-header-row">
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
        <div class="lesson-title">{lesson.title}</div>
    </div>
    <div class="lesson-footer">
        {#if lesson.lecturer}
            <div>{lesson.lecturer}</div>
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
    </div>
{/snippet}

{#if lesson.link}
    <a
        href={lesson.link}
        target="_blank"
        rel="noopener noreferrer"
        class="lesson-card {typeInfo.cssClass}"
        class:current-lesson-active={isActive}
        class:is-hidden={isHidden}
    >
        {@render cardContent()}
    </a>
{:else}
    <div
        class="lesson-card {typeInfo.cssClass}"
        class:current-lesson-active={isActive}
        class:is-hidden={isHidden}
    >
        {@render cardContent()}
    </div>
{/if}

