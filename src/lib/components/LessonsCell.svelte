<script lang="ts">
    import type { Lesson } from '$lib/schedule';
    import LessonCard from './LessonCard.svelte';

    interface Props {
        lessons: Lesson[];
        isSlotActive?: boolean;
        cellId: string;
        showRemoveControls?: boolean;
        onHideSubject?: (title: string) => void;
    }

    let { lessons, isSlotActive = false, cellId, showRemoveControls = false, onHideSubject }: Props = $props();

    let visibleLessons = $derived(lessons.slice(0, 3));
    let hiddenLessons = $derived(lessons.slice(3));
</script>

{#if lessons.length > 0}
    {#if lessons.length <= 3}
        {#each lessons as lesson (lesson.title + lesson.lecturer + lesson.type)}
            <LessonCard
                {lesson}
                isActive={isSlotActive}
                {showRemoveControls}
                onHide={onHideSubject}
            />
        {/each}
    {:else}
        {#each visibleLessons as lesson (lesson.title + lesson.lecturer + lesson.type)}
            <LessonCard
                {lesson}
                isActive={isSlotActive}
                {showRemoveControls}
                onHide={onHideSubject}
            />
        {/each}

        <input type="checkbox" id={cellId} class="lessons-toggle" />
        <label for={cellId} class="lessons-toggle-btn">+ Ще {hiddenLessons.length} предметів</label>
        
        <div class="lessons-expandable-content">
            <div class="lessons-expandable-inner d-flex flex-column gap-2 pt-2">
                {#each hiddenLessons as lesson (lesson.title + lesson.lecturer + lesson.type)}
                    <LessonCard
                        {lesson}
                        isActive={isSlotActive}
                        {showRemoveControls}
                        onHide={onHideSubject}
                    />
                {/each}
            </div>
        </div>
    {/if}
{/if}

