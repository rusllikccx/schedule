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

const HIDDEN_SUBJECTS_COOKIE = 'hidden_subjects';

/**
 * Loads the list of hidden subject titles from cookies (with migration/fallback from localStorage).
 */
export function loadHiddenSubjects(): string[] {
    const cookieVal = getCookie(HIDDEN_SUBJECTS_COOKIE);
    if (cookieVal) {
        try {
            const parsed = JSON.parse(cookieVal);
            if (Array.isArray(parsed)) return parsed;
        } catch {
            // ignore JSON parse error
        }
    }

    // Fallback/migration from localStorage if available
    if (typeof localStorage !== 'undefined') {
        try {
            const localVal = localStorage.getItem('hiddenSubjects');
            if (localVal) {
                const parsed = JSON.parse(localVal);
                if (Array.isArray(parsed)) {
                    saveHiddenSubjects(parsed);
                    return parsed;
                }
            }
        } catch {
            // ignore
        }
    }

    return [];
}

/**
 * Saves the list of hidden subject titles to cookies.
 */
export function saveHiddenSubjects(subjects: string[]): void {
    setCookie(HIDDEN_SUBJECTS_COOKIE, JSON.stringify(subjects));
}

/**
 * Clears the hidden subjects list from cookies and localStorage.
 */
export function clearHiddenSubjects(): void {
    deleteCookie(HIDDEN_SUBJECTS_COOKIE);
    if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('hiddenSubjects');
    }
}

const SHOW_HIDE_CONTROLS_COOKIE = 'show_hide_controls';

/**
 * Loads whether the remove/cross buttons should be displayed. Defaults to false.
 */
export function loadShowHideControls(): boolean {
    const val = getCookie(SHOW_HIDE_CONTROLS_COOKIE);
    return val === 'true';
}

/**
 * Saves whether the remove/cross buttons should be displayed.
 */
export function saveShowHideControls(show: boolean): void {
    setCookie(SHOW_HIDE_CONTROLS_COOKIE, String(show));
}
