/**
 * @fileoverview Browser Storage & User Settings module.
 * Provides type-safe persistence using `localStorage` with fallback to HTTP cookies.
 */

import { STORAGE_KEYS } from './constants';

/**
 * Reads a cookie value by its key.
 *
 * @param name - The name of the cookie to retrieve.
 * @returns Decoded cookie string value, or `null` if not found or executing in SSR.
 */
export function getCookie(name: string): string | null {
    if (typeof document === 'undefined') return null;
    const match = document.cookie.match(new RegExp('(^|;\\s*)(' + encodeURIComponent(name) + ')=([^;]*)'));
    return match && match[3] ? decodeURIComponent(match[3]) : null;
}

/**
 * Sets a persistent browser cookie with SameSite=Lax protection.
 *
 * @param name - Name of the cookie.
 * @param value - Raw string value to store.
 * @param days - Expiration duration in days (defaults to 365 days).
 * @param path - URL path scope (defaults to root '/').
 */
export function setCookie(name: string, value: string, days = 365, path = '/'): void {
    if (typeof document === 'undefined') return;
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; expires=${expires}; path=${path}; SameSite=Lax`;
}

/**
 * Deletes a cookie by expiring it immediately.
 *
 * @param name - Name of the cookie to remove.
 * @param path - URL path scope (defaults to root '/').
 */
export function deleteCookie(name: string, path = '/'): void {
    if (typeof document === 'undefined') return;
    document.cookie = `${encodeURIComponent(name)}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${path}; SameSite=Lax`;
}

/**
 * Generic type-safe getter for reading JSON-serialized values from `localStorage`.
 * Gracefully returns the provided fallback if `localStorage` is unavailable, empty, or unparseable.
 *
 * @template T - Target return type.
 * @param key - Storage key string.
 * @param fallback - Default value returned when the key does not exist or parsing fails.
 * @returns Stored parsed value or fallback.
 *
 * @example
 * ```ts
 * const hidden = getStorageItem<string[]>('hidden_subjects', []);
 * ```
 */
export function getStorageItem<T>(key: string, fallback: T): T {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
        return fallback;
    }
    try {
        const item = localStorage.getItem(key);
        if (item === null) return fallback;
        return JSON.parse(item) as T;
    } catch {
        return fallback;
    }
}

/**
 * Generic type-safe setter for serializing and storing JSON values into `localStorage`.
 *
 * @template T - Value payload type.
 * @param key - Storage key string.
 * @param value - Value to serialize and store.
 *
 * @example
 * ```ts
 * setStorageItem('hidden_subjects', ['Фізика']);
 * ```
 */
export function setStorageItem<T>(key: string, value: T): void {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
        return;
    }
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
        console.warn(`Failed to save key "${key}" to localStorage`, e);
    }
}

/**
 * Removes a key from `localStorage`.
 *
 * @param key - Storage key string to delete.
 */
export function removeStorageItem(key: string): void {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
        return;
    }
    try {
        localStorage.removeItem(key);
    } catch (e) {
        console.warn(`Failed to remove key "${key}" from localStorage`, e);
    }
}

/**
 * Loads the list of user-hidden subject titles from `localStorage` with cookie migration support.
 *
 * @returns Array of subject title strings that the user chose to hide.
 */
export function loadHiddenSubjects(): string[] {
    const localVal = getStorageItem<string[] | null>(STORAGE_KEYS.hiddenSubjects, null);
    if (Array.isArray(localVal)) {
        return localVal;
    }

    // Fallback/migration from cookie if available
    const cookieVal = getCookie(STORAGE_KEYS.hiddenSubjects);
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
 * Saves the user's hidden subjects list to both `localStorage` and a mirror cookie.
 *
 * @param subjects - Array of subject title strings.
 */
export function saveHiddenSubjects(subjects: string[]): void {
    setStorageItem(STORAGE_KEYS.hiddenSubjects, subjects);
    setCookie(STORAGE_KEYS.hiddenSubjects, JSON.stringify(subjects));
}

/**
 * Clears the hidden subjects list from both `localStorage` and cookies.
 */
export function clearHiddenSubjects(): void {
    removeStorageItem(STORAGE_KEYS.hiddenSubjects);
    deleteCookie(STORAGE_KEYS.hiddenSubjects);
}

/**
 * Loads the user's preference on whether schedule removal / edit controls are visible.
 *
 * @returns `true` if edit controls should be visible; otherwise `false`.
 */
export function loadShowHideControls(): boolean {
    const localVal = getStorageItem<boolean | null>(STORAGE_KEYS.showHideControls, null);
    if (typeof localVal === 'boolean') {
        return localVal;
    }

    const cookieVal = getCookie(STORAGE_KEYS.showHideControls);
    return cookieVal === 'true';
}

/**
 * Persists the user's preference on schedule edit controls visibility.
 *
 * @param show - `true` to display edit controls; `false` to hide them.
 */
export function saveShowHideControls(show: boolean): void {
    setStorageItem(STORAGE_KEYS.showHideControls, show);
    setCookie(STORAGE_KEYS.showHideControls, String(show));
}
