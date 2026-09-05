/**
 * Reads a cookie value by name.
 */
export function getCookie(name: string): string | null {
    if (typeof document === 'undefined') return null;
    const match = document.cookie.match(new RegExp('(^|;\\s*)(' + encodeURIComponent(name) + ')=([^;]*)'));
    return match ? decodeURIComponent(match[3]) : null;
}

/**
 * Sets a cookie with specified name, value, and expiration days (default 365 days).
 */
export function setCookie(name: string, value: string, days = 365, path = '/'): void {
    if (typeof document === 'undefined') return;
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; expires=${expires}; path=${path}; SameSite=Lax`;
}

/**
 * Deletes a cookie.
 */
export function deleteCookie(name: string, path = '/'): void {
    if (typeof document === 'undefined') return;
    document.cookie = `${encodeURIComponent(name)}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${path}; SameSite=Lax`;
}

const HIDDEN_SUBJECTS_KEY = 'hidden_subjects';
const SHOW_HIDE_CONTROLS_KEY = 'show_hide_controls';

/**
 * Loads the list of hidden subject titles from localStorage (with cookie migration fallback).
 */
export function loadHiddenSubjects(): string[] {
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        try {
            const localVal = localStorage.getItem(HIDDEN_SUBJECTS_KEY) || localStorage.getItem('hiddenSubjects');
            if (localVal) {
                const parsed = JSON.parse(localVal);
                if (Array.isArray(parsed)) return parsed;
            }
        } catch {
            // ignore
        }
    }

    // Fallback/migration from cookie if available
    const cookieVal = getCookie('hidden_subjects');
    if (cookieVal) {
        try {
            const parsed = JSON.parse(cookieVal);
            if (Array.isArray(parsed)) {
                saveHiddenSubjects(parsed);
                return parsed;
            }
        } catch {
            // ignore
        }
    }

    return [];
}

/**
 * Saves the list of hidden subject titles to localStorage.
 */
export function saveHiddenSubjects(subjects: string[]): void {
    const jsonStr = JSON.stringify(subjects);
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        try {
            localStorage.setItem(HIDDEN_SUBJECTS_KEY, jsonStr);
        } catch (e) {
            console.warn('Failed to save hidden subjects to localStorage', e);
        }
    }
    // Also mirror to cookie for safety
    setCookie('hidden_subjects', jsonStr);
}

/**
 * Clears the hidden subjects list from localStorage and cookies.
 */
export function clearHiddenSubjects(): void {
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        try {
            localStorage.removeItem(HIDDEN_SUBJECTS_KEY);
            localStorage.removeItem('hiddenSubjects');
        } catch (e) {
            console.warn('Failed to clear hidden subjects from localStorage', e);
        }
    }
    deleteCookie('hidden_subjects');
}

/**
 * Loads whether the remove/cross buttons should be displayed. Defaults to false.
 */
export function loadShowHideControls(): boolean {
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        try {
            const localVal = localStorage.getItem(SHOW_HIDE_CONTROLS_KEY);
            if (localVal !== null) {
                return localVal === 'true';
            }
        } catch {
            // ignore
        }
    }

    const val = getCookie('show_hide_controls');
    return val === 'true';
}

/**
 * Saves whether the remove/cross buttons should be displayed in localStorage.
 */
export function saveShowHideControls(show: boolean): void {
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        try {
            localStorage.setItem(SHOW_HIDE_CONTROLS_KEY, String(show));
        } catch (e) {
            console.warn('Failed to save show_hide_controls to localStorage', e);
        }
    }
    setCookie('show_hide_controls', String(show));
}

const ADMIN_TOKEN_KEY = 'kpi_admin_token_v1';

export function getStoredAdminPassword(): string {
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        try {
            return localStorage.getItem(ADMIN_TOKEN_KEY) || '';
        } catch {
            // ignore
        }
    }
    return '';
}

export function saveStoredAdminPassword(password: string): void {
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        try {
            if (password) {
                localStorage.setItem(ADMIN_TOKEN_KEY, password);
            } else {
                localStorage.removeItem(ADMIN_TOKEN_KEY);
            }
        } catch (e) {
            console.warn('Failed to save admin token to localStorage', e);
        }
    }
}
