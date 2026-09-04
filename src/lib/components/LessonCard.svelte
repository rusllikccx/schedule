<script lang="ts">
    import { LESSON_TYPES, LessonType, type Lesson } from '$lib/schedule';

    interface Props {
        lesson: Lesson;
        isActive?: boolean;
        showRemoveControls?: boolean;
        onHide?: (title: string) => void;
    }

    let { lesson, isActive = false, showRemoveControls = false, onHide }: Props = $props();

    let typeInfo = $derived(LESSON_TYPES[lesson.type] || LESSON_TYPES[LessonType.Other]);

    function handleHide(e: MouseEvent) {
        e.preventDefault();
        e.stopPropagation();
        onHide?.(lesson.title);
    }
</script>

{#snippet cardContent()}
    <div style="position: relative;">
        {#if showRemoveControls && onHide}
            <button
                type="button"
                class="hide-subject-btn"
                onclick={handleHide}
                title="Приховати дисципліну"
                aria-label="Приховати дисципліну"
            >
                ✕
            </button>
        {/if}
        <span class="badge-type">{typeInfo.name}</span>
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
    >
        {@render cardContent()}
    </a>
{:else}
    <div
        class="lesson-card {typeInfo.cssClass}"
        class:current-lesson-active={isActive}
    >
        {@render cardContent()}
    </div>
{/if}

