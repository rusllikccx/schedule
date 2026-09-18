<script lang="ts">
    import type { OnlineLink, ScheduleData, BackupInfo } from '$lib/types';
    import {
        saveLinksToServer,
        loginAdmin,
        checkAdminAuth,
        logoutAdmin,
        fetchBackupsHistory,
        rollbackLinksBackup
    } from '$lib/services/api';

    interface Props {
        isOpen: boolean;
        links: OnlineLink[];
        scheduleData?: ScheduleData;
        initialPassword?: string;
        onClose: () => void;
        onSaveSuccess: (updatedLinks: OnlineLink[], password?: string) => void;
    }

    let {
        isOpen = false,
        links = [],
        scheduleData,
        onClose,
        onSaveSuccess
    }: Props = $props();

    // Authentication state
    let isAuthenticated = $state(false);
    let isCheckingAuth = $state(false);
    let isLoggingIn = $state(false);
    let loginPassword = $state('');
    let authError = $state<string | null>(null);

    // Links editor state
    let searchQuery = $state('');
    let editableLinks = $state<OnlineLink[]>([]);
    let isSaving = $state(false);
    let errorMessage = $state<string | null>(null);
    let successMessage = $state<string | null>(null);

    // Mode for adding discipline from schedule
    let isAddingMode = $state(false);
    let addSearchQuery = $state('');

    // Mode for Backups & History
    let isBackupsMode = $state(false);
    let backupsList = $state<BackupInfo[]>([]);
    let isLoadingBackups = $state(false);
    let isRollingBack = $state(false);

    // Extract all unique disciplines and lecturers present in the schedule
    let availableScheduleSubjects = $derived.by(() => {
        if (!scheduleData) return [];
        const map = new Map<string, { title: string; lecturer: string }>();

        const inspectWeek = (weekMap: typeof scheduleData.week1) => {
            for (const dayCode of Object.keys(weekMap)) {
                const daySlots = weekMap[dayCode as keyof typeof weekMap];
                if (!daySlots) continue;
                for (const slotStr of Object.keys(daySlots)) {
                    const lessons = daySlots[Number(slotStr) as 1 | 2 | 3 | 4 | 5 | 6] || [];
                    for (const l of lessons) {
                        const key = `${l.title.trim()}|${(l.lecturer || '').trim()}`.toLowerCase();
                        if (!map.has(key)) {
                            map.set(key, {
                                title: l.title.trim(),
                                lecturer: (l.lecturer || '').trim()
                            });
                        }
                    }
                }
            }
        };

        inspectWeek(scheduleData.week1);
        inspectWeek(scheduleData.week2);

        return Array.from(map.values()).sort((a, b) => a.title.localeCompare(b.title));
    });

    // Filter available subjects based on addSearchQuery
    let filteredScheduleSubjects = $derived.by(() => {
        const q = addSearchQuery.trim().toLowerCase();
        if (!q) return availableScheduleSubjects;
        return availableScheduleSubjects.filter(s =>
            s.title.toLowerCase().includes(q) ||
            s.lecturer.toLowerCase().includes(q)
        );
    });

    // Synchronize editable list whenever modal opens or links change
    $effect(() => {
        if (isOpen) {
            editableLinks = links.map(l => ({ ...l }));
            errorMessage = null;
            successMessage = null;
            searchQuery = '';
            isAddingMode = false;
            isBackupsMode = false;
            addSearchQuery = '';
            loginPassword = '';
            authError = null;

            void checkAuthStatus();
        }
    });

    async function checkAuthStatus() {
        isCheckingAuth = true;
        try {
            const authed = await checkAdminAuth();
            isAuthenticated = authed;
        } finally {
            isCheckingAuth = false;
        }
    }

    async function handleLogin(e?: Event) {
        if (e) e.preventDefault();
        const pwd = loginPassword.trim();
        if (!pwd) {
            authError = 'Введіть пароль адміністратора';
            return;
        }

        isLoggingIn = true;
        authError = null;

        const res = await loginAdmin(pwd);
        isLoggingIn = false;

        if (res.success) {
            isAuthenticated = true;
            loginPassword = '';
            authError = null;
        } else {
            authError = res.error || 'Невірний пароль або сервер недоступний';
        }
    }

    async function handleLogout() {
        await logoutAdmin();
        isAuthenticated = false;
        loginPassword = '';
        authError = null;
        isBackupsMode = false;
    }

    async function openBackups() {
        isBackupsMode = true;
        isLoadingBackups = true;
        errorMessage = null;
        successMessage = null;
        try {
            backupsList = await fetchBackupsHistory();
        } finally {
            isLoadingBackups = false;
        }
    }

    async function handleRollback(filename: string) {
        if (!confirm(`Відновити версію розкладу з бекапу ${filename}?`)) {
            return;
        }
        isRollingBack = true;
        errorMessage = null;
        successMessage = null;

        const res = await rollbackLinksBackup(filename);
        isRollingBack = false;

        if (res.success) {
            successMessage = 'Розклад успішно відновлено з бекапу!';
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        } else {
            errorMessage = res.error || 'Не вдалося відновити бекап';
        }
    }

    let filteredLinks = $derived.by(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return editableLinks;
        return editableLinks.filter(l =>
            (l.title && l.title.toLowerCase().includes(q)) ||
            (l.lecturer && l.lecturer.toLowerCase().includes(q)) ||
            (l.link && l.link.toLowerCase().includes(q)) ||
            (l.password && l.password.toLowerCase().includes(q))
        );
    });

    function startAdding() {
        isAddingMode = true;
        addSearchQuery = '';
        errorMessage = null;
    }

    function cancelAdding() {
        isAddingMode = false;
        addSearchQuery = '';
    }

    function selectSubjectToAdd(subj: { title: string; lecturer: string }) {
        editableLinks = [
            { title: subj.title, lecturer: subj.lecturer, link: '', password: '' },
            ...editableLinks
        ];
        isAddingMode = false;
        addSearchQuery = '';
        searchQuery = subj.title;
    }

    function addCustomEmptyLink() {
        editableLinks = [
            { title: addSearchQuery.trim(), lecturer: '', link: '', password: '' },
            ...editableLinks
        ];
        isAddingMode = false;
        addSearchQuery = '';
    }

    function handleRemoveLink(index: number) {
        editableLinks = editableLinks.filter((_, i) => i !== index);
    }

    async function handleSave() {
        const cleaned: OnlineLink[] = [];
        for (const item of editableLinks) {
            const t = (item.title || '').trim();
            const l = (item.link || '').trim();
            const lect = (item.lecturer || '').trim();
            const pwd = (item.password || '').trim();
            if (!t && !l && !pwd) continue;
            if (!t) {
                errorMessage = 'Кожен запис повинен мати назву дисципліни';
                return;
            }
            cleaned.push({
                title: t,
                lecturer: lect,
                link: l,
                ...(pwd ? { password: pwd } : {})
            });
        }

        isSaving = true;
        errorMessage = null;
        successMessage = null;

        const result = await saveLinksToServer(cleaned);
        isSaving = false;

        if (result.success) {
            successMessage = 'Посилання успішно оновлено на сервері!';
            onSaveSuccess(cleaned);
            setTimeout(() => {
                onClose();
            }, 1200);
        } else {
            if (result.error && (result.error.includes('401') || result.error.includes('авторизація') || result.error.includes('Unauthorized'))) {
                isAuthenticated = false;
                authError = 'Сесія адміністратора закінчилась. Будь ласка, увійдіть знову.';
            } else {
                errorMessage = result.error || 'Помилка збереження на сервер';
            }
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
            {#if isCheckingAuth}
                <div class="text-center py-5">
                    <div class="spinner-border text-primary mb-3" role="status">
                        <span class="visually-hidden">Завантаження...</span>
                    </div>
                    <div class="text-muted small">Перевірка доступу...</div>
                </div>
            {:else if !isAuthenticated}
                <!-- Login View -->
                <div class="admin-login-card mx-auto my-3 p-4 border rounded-3 bg-light shadow-sm text-center" style="max-width: 400px;">
                    <div class="display-6 mb-2">🔐</div>
                    <h5 class="fw-bold mb-1">Авторизація адміністратора</h5>
                    <p class="text-muted small mb-4">
                        Для додавання або зміни спільних посилань на пари введіть пароль старости / адміністратора.
                    </p>

                    <form onsubmit={handleLogin} class="text-start">
                        <div class="mb-3">
                            <label for="admin-login-pwd" class="form-label fw-semibold small mb-1">
                                Пароль доступу:
                            </label>
                            <input
                                type="password"
                                id="admin-login-pwd"
                                class="form-control"
                                placeholder="Введіть пароль..."
                                bind:value={loginPassword}
                                disabled={isLoggingIn}
                                autocomplete="current-password"
                            />
                        </div>

                        {#if authError}
                            <div class="alert alert-danger py-2 small mb-3">
                                {authError}
                            </div>
                        {/if}

                        <button
                            type="submit"
                            class="btn btn-primary w-100 fw-semibold d-flex align-items-center justify-content-center gap-2 py-2"
                            disabled={isLoggingIn || !loginPassword.trim()}
                        >
                            {#if isLoggingIn}
                                <span class="spinner-border spinner-border-sm" role="status"></span>
                                <span>Перевірка...</span>
                            {:else}
                                <span>🔓 Увійти</span>
                            {/if}
                        </button>
                    </form>
                </div>
            {:else}
                <!-- Authenticated Links Management View -->
                <div class="d-flex justify-content-between align-items-center mb-3 p-2 bg-light border rounded">
                    <div class="d-flex align-items-center gap-2 small text-success fw-semibold">
                        <span>🛡️</span>
                        <span>Авторизовано (сесія дійсна 24 год)</span>
                    </div>
                    <div class="d-flex gap-2">
                        {#if isBackupsMode}
                            <button
                                type="button"
                                class="btn btn-sm btn-outline-primary py-1 px-2 small"
                                onclick={() => (isBackupsMode = false)}
                            >
                                ✏️ Редактор посилань
                            </button>
                        {:else}
                            <button
                                type="button"
                                class="btn btn-sm btn-outline-secondary py-1 px-2 small"
                                onclick={openBackups}
                                title="Історія змін та резервні копії"
                            >
                                🕒 Історія (бекапи)
                            </button>
                        {/if}
                        <button
                            type="button"
                            class="btn btn-sm btn-outline-danger py-1 px-2 small"
                            onclick={handleLogout}
                            title="Завершити поточну сесію"
                        >
                            Вийти
                        </button>
                    </div>
                </div>

                {#if isBackupsMode}
                    <!-- Backups & Rollback View -->
                    <div class="backups-view mb-3">
                        <div class="d-flex justify-content-between align-items-center mb-2">
                            <span class="fw-bold small text-primary">🕒 Історія збережень (останні версії):</span>
                        </div>

                        {#if isLoadingBackups}
                            <div class="text-center py-4 text-muted small">
                                <span class="spinner-border spinner-border-sm me-1" role="status"></span>
                                Завантаження історії...
                            </div>
                        {:else if backupsList.length === 0}
                            <div class="text-center py-4 text-muted small bg-light rounded border">
                                Історія бекапів порожня.
                            </div>
                        {:else}
                            <div class="d-flex flex-column gap-2" style="max-height: 48vh; overflow-y: auto;">
                                {#each backupsList as b}
                                    <div class="p-2 border rounded bg-white shadow-sm d-flex justify-content-between align-items-center">
                                        <div>
                                            <div class="fw-semibold small">{b.createdAt}</div>
                                            <small class="text-muted font-monospace">{b.filename} ({Math.round(b.size / 1024)} KB)</small>
                                        </div>
                                        <button
                                            type="button"
                                            class="btn btn-sm btn-outline-warning text-dark fw-semibold"
                                            disabled={isRollingBack}
                                            onclick={() => handleRollback(b.filename)}
                                        >
                                            ↺ Відновити
                                        </button>
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    </div>
                {:else}
                    <!-- Links Editor View -->
                    {#if !isAddingMode}
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
                                onclick={startAdding}
                            >
                                + Додати дисципліну
                            </button>
                        </div>
                    {:else}
                        <div class="add-subject-picker p-3 border rounded mb-3 bg-light">
                            <div class="d-flex justify-content-between align-items-center mb-2">
                                <span class="fw-bold small text-primary">📚 Оберіть дисципліну з розкладу:</span>
                                <button
                                    type="button"
                                    class="btn btn-sm btn-outline-secondary py-0 px-2 small"
                                    onclick={cancelAdding}
                                >
                                    Скасувати
                                </button>
                            </div>

                            <div class="input-group input-group-sm mb-2">
                                <span class="input-group-text">🔍</span>
                                <input
                                    type="text"
                                    class="form-control"
                                    placeholder="Введіть назву дисципліни з розкладу..."
                                    bind:value={addSearchQuery}
                                />
                                {#if addSearchQuery.trim()}
                                    <button
                                        type="button"
                                        class="btn btn-primary"
                                        onclick={addCustomEmptyLink}
                                        title="Створити нову дисципліну з такою назвою"
                                    >
                                        Створити "{addSearchQuery.trim().slice(0, 18)}"
                                    </button>
                                {/if}
                            </div>

                            <div class="schedule-subjects-list">
                                {#if filteredScheduleSubjects.length === 0}
                                    <div class="p-2 text-center text-muted small bg-white rounded border">
                                        Дисципліну не знайдено в поточному розкладі.
                                        {#if addSearchQuery.trim()}
                                            <button
                                                type="button"
                                                class="btn btn-link btn-sm p-0 ms-1"
                                                onclick={addCustomEmptyLink}
                                            >
                                                Додати вручну
                                            </button>
                                        {/if}
                                    </div>
                                {:else}
                                    <div class="d-flex flex-column gap-1" style="max-height: 200px; overflow-y: auto;">
                                        {#each filteredScheduleSubjects as subj}
                                            <button
                                                type="button"
                                                class="schedule-subject-item btn btn-sm btn-outline-light text-dark text-start d-flex justify-content-between align-items-center p-2 border"
                                                onclick={() => selectSubjectToAdd(subj)}
                                            >
                                                <div class="text-truncate me-2">
                                                    <div class="fw-semibold text-truncate">{subj.title}</div>
                                                    {#if subj.lecturer}
                                                        <small class="text-muted text-truncate">{subj.lecturer}</small>
                                                    {/if}
                                                </div>
                                                <span class="badge bg-primary rounded-pill">+ Обрати</span>
                                            </button>
                                        {/each}
                                    </div>
                                {/if}
                            </div>
                        </div>
                    {/if}

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
                                    {#if !searchQuery || (item.title && item.title.toLowerCase().includes(searchQuery.toLowerCase())) || (item.lecturer && item.lecturer.toLowerCase().includes(searchQuery.toLowerCase())) || (item.link && item.link.toLowerCase().includes(searchQuery.toLowerCase())) || (item.password && item.password.toLowerCase().includes(searchQuery.toLowerCase()))}
                                        <div class="link-item-row p-2 border rounded bg-white shadow-sm">
                                            <div class="row g-2 align-items-center">
                                                <div class="col-12 col-md-4">
                                                    <input
                                                        type="text"
                                                        class="form-control form-control-sm"
                                                        placeholder="Назва дисципліни"
                                                        bind:value={item.title}
                                                        title="Назва дисципліни"
                                                    />
                                                </div>
                                                <div class="col-12 col-sm-6 col-md-2">
                                                    <input
                                                        type="text"
                                                        class="form-control form-control-sm"
                                                        placeholder="Викладач (необов.)"
                                                        bind:value={item.lecturer}
                                                        title="Прізвище викладача"
                                                    />
                                                </div>
                                                <div class="col-12 col-sm-6 col-md-3">
                                                    <input
                                                        type="url"
                                                        class="form-control form-control-sm"
                                                        placeholder="https://zoom.us/..."
                                                        bind:value={item.link}
                                                        title="URL посилання"
                                                    />
                                                </div>
                                                <div class="col-9 col-md-2">
                                                    <input
                                                        type="text"
                                                        class="form-control form-control-sm font-monospace"
                                                        placeholder="🔑 Пароль"
                                                        bind:value={item.password}
                                                        title="Пароль або код конференції (необов'язково)"
                                                    />
                                                </div>
                                                <div class="col-3 col-md-1 text-end">
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
                {/if}
            {/if}
        </div>

        <div class="links-modal-footer d-flex justify-content-between align-items-center">
            {#if isAuthenticated && !isBackupsMode}
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
                            <span class="spinner-border spinner-border-sm me-1" role="status"></span>
                            Збереження...
                        {:else}
                            💾 Зберегти на сервер
                        {/if}
                    </button>
                </div>
            {:else}
                <div></div>
                <button type="button" class="btn btn-sm btn-secondary px-3" onclick={onClose}>
                    Закрити
                </button>
            {/if}
        </div>
    </div>
{/if}

<style>
    .links-modal-backdrop {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background-color: rgba(15, 23, 42, 0.55);
        backdrop-filter: blur(3px);
        z-index: 1050;
    }

    .links-modal {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 95%;
        max-width: 820px;
        max-height: 88vh;
        background-color: #ffffff;
        border-radius: 12px;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
        z-index: 1060;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        animation: modal-fade-in 0.18s ease-out;
    }

    @keyframes modal-fade-in {
        from {
            opacity: 0;
            transform: translate(-50%, -46%);
        }
        to {
            opacity: 1;
            transform: translate(-50%, -50%);
        }
    }

    .links-modal-header {
        padding: 14px 18px;
        border-bottom: 1px solid #e2e8f0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        background-color: #f8fafc;
    }

    .links-modal-body {
        padding: 16px 18px;
        overflow-y: auto;
        flex: 1 1 auto;
    }

    .links-table-wrapper {
        max-height: 48vh;
        overflow-y: auto;
        padding-right: 4px;
    }

    .link-item-row {
        transition: background-color 0.15s ease;
    }

    .link-item-row:hover {
        background-color: #f8fafc;
    }

    .links-modal-footer {
        padding: 12px 18px;
        border-top: 1px solid #e2e8f0;
        background-color: #f8fafc;
    }

    .add-subject-picker {
        background-color: #f8faff !important;
        border-color: #cbd5e1 !important;
        animation: modal-fade-in 0.15s ease-out;
    }

    .schedule-subjects-list {
        max-height: 200px;
        overflow-y: auto;
        padding-right: 2px;
    }

    .schedule-subject-item {
        background-color: #ffffff !important;
        border-color: #e2e8f0 !important;
        transition: background-color 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
    }

    .schedule-subject-item:hover {
        background-color: #eff6ff !important;
        border-color: #93c5fd !important;
        transform: translateY(-1px);
    }
</style>
