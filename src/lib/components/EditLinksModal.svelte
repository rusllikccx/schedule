<script lang="ts">
    import type { OnlineLink } from '$lib/types';
    import { saveLinksToServer } from '$lib/schedule';
    import { saveStoredAdminPassword } from '$lib/cookies';

    interface Props {
        isOpen: boolean;
        links: OnlineLink[];
        initialPassword?: string;
        onClose: () => void;
        onSaveSuccess: (updatedLinks: OnlineLink[], password: string) => void;
    }

    let {
        isOpen = false,
        links = [],
        initialPassword = '',
        onClose,
        onSaveSuccess
    }: Props = $props();

    let password = $state('');
    let searchQuery = $state('');
    let editableLinks = $state<OnlineLink[]>([]);
    let isSaving = $state(false);
    let errorMessage = $state<string | null>(null);
    let successMessage = $state<string | null>(null);

    // Synchronize editable list whenever modal opens or links change
    $effect(() => {
        if (isOpen) {
            password = initialPassword;
            editableLinks = links.map(l => ({ ...l }));
            errorMessage = null;
            successMessage = null;
            searchQuery = '';
        }
    });

    let filteredLinks = $derived.by(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return editableLinks;
        return editableLinks.filter(l =>
            (l.title && l.title.toLowerCase().includes(q)) ||
            (l.lecturer && l.lecturer.toLowerCase().includes(q)) ||
            (l.link && l.link.toLowerCase().includes(q))
        );
    });

    function handleAddLink() {
        editableLinks = [
            { title: '', lecturer: '', link: '' },
            ...editableLinks
        ];
    }

    function handleRemoveLink(index: number) {
        editableLinks = editableLinks.filter((_, i) => i !== index);
    }

    async function handleSave() {
        if (!password.trim()) {
            errorMessage = 'Введіть пароль адміністратора';
            return;
        }

        // Validate links
        const cleaned: OnlineLink[] = [];
        for (const item of editableLinks) {
            const t = (item.title || '').trim();
            const l = (item.link || '').trim();
            const lect = (item.lecturer || '').trim();
            if (!t && !l) continue; // skip empty rows
            if (!t) {
                errorMessage = 'Кожен запис повинен мати назву дисципліни';
                return;
            }
            cleaned.push({
                title: t,
                lecturer: lect,
                link: l
            });
        }

        isSaving = true;
        errorMessage = null;
        successMessage = null;

        const result = await saveLinksToServer(cleaned, password);
        isSaving = false;

        if (result.success) {
            saveStoredAdminPassword(password.trim());
            successMessage = 'Посилання успішно оновлено на сервері!';
            onSaveSuccess(cleaned, password.trim());
            setTimeout(() => {
                onClose();
            }, 1200);
        } else {
            errorMessage = result.error || 'Помилка збереження на сервер';
        }
    }
</script>

{#if isOpen}
    <!-- Modal Backdrop -->
    <div class="links-modal-backdrop" onclick={onClose} role="presentation"></div>

    <div class="links-modal" role="dialog" aria-modal="true" aria-labelledby="admin-modal-title">
        <div class="links-modal-header">
            <h5 class="m-0 fw-bold" id="admin-modal-title">🔗 Управління посиланнями на пари</h5>
            <button type="button" class="btn-close" aria-label="Закрити" onclick={onClose}></button>
        </div>

        <div class="links-modal-body">
            <!-- Password row -->
            <div class="mb-3">
                <label for="admin-pwd" class="form-label fw-semibold small mb-1">Пароль адміністратора / старости:</label>
                <input
                    type="password"
                    id="admin-pwd"
                    class="form-control form-control-sm"
                    placeholder="Введіть пароль для збереження на сервер"
                    bind:value={password}
                />
            </div>

            <!-- Toolbar row: search + add button -->
            <div class="d-flex flex-column flex-sm-row justify-content-between gap-2 mb-3">
                <input
                    type="text"
                    class="form-control form-control-sm"
                    placeholder="🔍 Пошук за назвою або викладачем..."
                    bind:value={searchQuery}
                />
                <button
                    type="button"
                    class="btn btn-sm btn-outline-primary text-nowrap fw-semibold"
                    onclick={handleAddLink}
                >
                    + Додати дисципліну
                </button>
            </div>

            {#if errorMessage}
                <div class="alert alert-danger py-2 small mb-3">{errorMessage}</div>
            {/if}

            {#if successMessage}
                <div class="alert alert-success py-2 small mb-3">{successMessage}</div>
            {/if}

            <!-- Links list -->
            <div class="links-table-wrapper">
                {#if filteredLinks.length === 0}
                    <div class="text-center py-4 text-muted small">
                        {searchQuery ? 'Нічого не знайдено за вашим запитом' : 'Список посилань порожній'}
                    </div>
                {:else}
                    <div class="d-flex flex-column gap-2">
                        {#each editableLinks as item, index}
                            <!-- Show only matching items if searching -->
                            {#if !searchQuery || (item.title && item.title.toLowerCase().includes(searchQuery.toLowerCase())) || (item.lecturer && item.lecturer.toLowerCase().includes(searchQuery.toLowerCase())) || (item.link && item.link.toLowerCase().includes(searchQuery.toLowerCase()))}
                                <div class="link-item-row p-2 border rounded bg-white shadow-sm">
                                    <div class="row g-2 align-items-center">
                                        <div class="col-12 col-md-5">
                                            <input
                                                type="text"
                                                class="form-control form-control-sm"
                                                placeholder="Назва дисципліни"
                                                bind:value={item.title}
                                                title="Назва дисципліни"
                                            />
                                        </div>
                                        <div class="col-12 col-md-3">
                                            <input
                                                type="text"
                                                class="form-control form-control-sm"
                                                placeholder="Викладач (необов.)"
                                                bind:value={item.lecturer}
                                                title="Прізвище викладача"
                                            />
                                        </div>
                                        <div class="col-10 col-md-3">
                                            <input
                                                type="url"
                                                class="form-control form-control-sm"
                                                placeholder="https://zoom.us/..."
                                                bind:value={item.link}
                                                title="URL посилання"
                                            />
                                        </div>
                                        <div class="col-2 col-md-1 text-end">
                                            <button
                                                type="button"
                                                class="btn btn-sm btn-outline-danger w-100 p-1"
                                                onclick={() => handleRemoveLink(index)}
                                                title="Видалити це посилання"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            {/if}
                        {/each}
                    </div>
                {/if}
            </div>
        </div>

        <div class="links-modal-footer d-flex justify-content-between align-items-center">
            <span class="text-muted small">Всього: {editableLinks.length}</span>
            <div class="d-flex gap-2">
                <button type="button" class="btn btn-sm btn-secondary" onclick={onClose} disabled={isSaving}>
                    Скасувати
                </button>
                <button
                    type="button"
                    class="btn btn-sm btn-success fw-semibold px-3"
                    onclick={handleSave}
                    disabled={isSaving}
                >
                    {#if isSaving}
                        Збереження...
                    {:else}
                        💾 Зберегти на сервер
                    {/if}
                </button>
            </div>
        </div>
    </div>
{/if}

