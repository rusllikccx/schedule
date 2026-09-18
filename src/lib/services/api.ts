/**
 * @fileoverview Remote API client module.
 *
 * Handles:
 * 1. KPI Campus schedule fetching with early `<head>` promise consumption and local caching.
 * 2. Online links synchronization with Go backend (supports ETag conditional GETs).
 * 3. Administrator session authentication (`/api/auth/*`).
 * 4. Backup history listing and version rollbacks (`/api/backups/*`).
 */

import type { OnlineLink, ApiScheduleResponse, ScheduleData, BackupInfo } from '../types';
import { API_URL, LINKS_API_URL, STORAGE_KEYS } from '../constants';
import { getStorageItem, setStorageItem, removeStorageItem } from '../storage';
import { transformWeekData } from '../utils/transformers';
import { setActiveOnlineLinks } from './linkMatcher';

/**
 * Fetches and transforms schedule data for both academic weeks from the KPI Campus REST API.
 * Supports stale-while-revalidate caching and early fetch resolution initiated in the HTML `<head>`.
 *
 * @param url - Endpoint URL to request (defaults to {@link API_URL}).
 * @param fetchFn - Custom `fetch` function implementation (defaults to window.fetch).
 * @returns Fully transformed {@link ScheduleData} object containing `week1` and `week2`.
 * @throws {Error} When network request fails or API returns an invalid response.
 */
export async function fetchSchedule(
    url = API_URL,
    fetchFn: typeof fetch = fetch
): Promise<ScheduleData> {
    let rawData: ApiScheduleResponse | null = null;

    // Check if early fetch was started in HTML head
    if (typeof window !== 'undefined' && window.__SCHEDULE_PROMISE__) {
        try {
            rawData = await window.__SCHEDULE_PROMISE__;
        } catch {
            rawData = null;
        } finally {
            window.__SCHEDULE_PROMISE__ = undefined;
        }
    }

    // Fallback if early fetch wasn't present or failed
    if (!rawData) {
        const response = await fetchFn(url);
        if (!response.ok) {
            throw new Error(`HTTP помилка: ${response.status}`);
        }
        rawData = (await response.json()) as ApiScheduleResponse;
    }

    if (!rawData || !rawData.scheduleFirstWeek) {
        throw new Error('Отримано порожню або некоректну відповідь від API');
    }

    const transformed: ScheduleData = {
        week1: transformWeekData(rawData.scheduleFirstWeek),
        week2: transformWeekData(rawData.scheduleSecondWeek)
    };

    // Save to permanent client cache
    setStorageItem(STORAGE_KEYS.scheduleCache, transformed);
    setStorageItem(STORAGE_KEYS.scheduleUpdatedAt, new Date().toISOString());

    return transformed;
}

/**
 * Fetches the latest online links from the Go backend.
 * Uses HTTP `If-None-Match` and `ETag` to achieve 0-byte transfers when data is unmodified (HTTP 304).
 *
 * @param apiUrl - Target endpoint URL (defaults to {@link LINKS_API_URL}).
 * @returns Array of updated {@link OnlineLink} items, or `null` if unchanged (HTTP 304) or offline.
 */
export async function fetchServerOnlineLinks(apiUrl = LINKS_API_URL): Promise<OnlineLink[] | null> {
    try {
        const storedETag = getStorageItem<string | null>(STORAGE_KEYS.onlineLinksETag, null);
        const headers: Record<string, string> = {};
        if (storedETag) {
            headers['If-None-Match'] = storedETag;
        }

        const res = await fetch(apiUrl, { headers });

        if (res.status === 304) {
            return null; // Local cached links are already up to date
        }

        if (res.ok) {
            const newETag = res.headers.get('ETag');
            if (newETag) {
                setStorageItem(STORAGE_KEYS.onlineLinksETag, newETag);
            }
            const data = (await res.json()) as OnlineLink[];
            if (Array.isArray(data) && data.length > 0) {
                setActiveOnlineLinks(data);
                setStorageItem(STORAGE_KEYS.onlineLinks, data);
                setStorageItem(STORAGE_KEYS.onlineLinksUpdatedAt, new Date().toISOString());
                return data;
            }
        }
    } catch {
        // Backend offline or user without internet
    }
    return null;
}

/**
 * Authenticates the administrator against the Go backend using the master password.
 * Receives a 24-hour session token and stores it in `localStorage` & HttpOnly cookie.
 *
 * @param password - Master admin password.
 * @returns Result object with `success: true` or `error` message string.
 */
export async function loginAdmin(password: string): Promise<{ success: boolean; error?: string }> {
    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: password.trim() }),
            credentials: 'include'
        });

        const data = (await res.json().catch(() => ({}))) as { error?: string; token?: string };
        if (!res.ok) {
            return { success: false, error: data.error || `Помилка входу (HTTP ${res.status})` };
        }

        if (data.token) {
            setStorageItem(STORAGE_KEYS.adminSession, data.token);
        }
        return { success: true };
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, error: `Не вдалося з'єднатися із сервером: ${msg}` };
    }
}

/**
 * Checks whether the current client holds an active, valid administrator session.
 *
 * @returns `true` if authorized; `false` otherwise.
 */
export async function checkAdminAuth(): Promise<boolean> {
    try {
        const token = getStorageItem<string | null>(STORAGE_KEYS.adminSession, null);
        const headers: Record<string, string> = {};
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        const res = await fetch('/api/auth/check', {
            headers,
            credentials: 'include'
        });
        if (res.ok) {
            const data = (await res.json().catch(() => ({}))) as { authenticated?: boolean };
            return data.authenticated === true;
        }
    } catch {
        // ignore
    }
    return false;
}

/**
 * Logs out the administrator by terminating the active session on both client and server.
 */
export async function logoutAdmin(): Promise<void> {
    try {
        const token = getStorageItem<string | null>(STORAGE_KEYS.adminSession, null);
        const headers: Record<string, string> = {};
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        await fetch('/api/auth/logout', {
            method: 'POST',
            headers,
            credentials: 'include'
        });
    } catch {
        // ignore
    } finally {
        removeStorageItem(STORAGE_KEYS.adminSession);
    }
}

/**
 * Saves the full updated list of online links to the Go backend API.
 * Automatically persists to local cache and updates matching indexes on success.
 *
 * @param links - Array of {@link OnlineLink} items to save.
 * @param password - Optional fallback password if no active session token exists.
 * @param apiUrl - Target endpoint (defaults to {@link LINKS_API_URL}).
 * @returns Result object with `success: true` or `error` message string.
 */
export async function saveLinksToServer(
    links: OnlineLink[],
    password?: string,
    apiUrl = LINKS_API_URL
): Promise<{ success: boolean; error?: string }> {
    try {
        const token = getStorageItem<string | null>(STORAGE_KEYS.adminSession, null);
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };
        const authValue = token || (password ? password.trim() : '');
        if (authValue) {
            headers['Authorization'] = `Bearer ${authValue}`;
        }

        const res = await fetch(apiUrl, {
            method: 'POST',
            headers,
            credentials: 'include',
            body: JSON.stringify(links)
        });

        if (res.status === 401) {
            return { success: false, error: 'Потрібна авторизація. Будь ласка, увійдіть як адміністратор.' };
        }

        if (!res.ok) {
            const data = (await res.json().catch(() => ({}))) as { error?: string };
            return { success: false, error: data.error || `Помилка сервера HTTP ${res.status}` };
        }

        const newETag = res.headers.get('ETag');
        if (newETag) {
            setStorageItem(STORAGE_KEYS.onlineLinksETag, newETag);
        }

        setActiveOnlineLinks(links);
        setStorageItem(STORAGE_KEYS.onlineLinks, links);
        setStorageItem(STORAGE_KEYS.onlineLinksUpdatedAt, new Date().toISOString());

        return { success: true };
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, error: `Не вдалося зв'язатися із сервером: ${msg}` };
    }
}

/**
 * Fetches list of all timestamped schedule backups available on the backend server.
 * Requires administrator authentication.
 *
 * @returns Array of {@link BackupInfo} descriptors sorted chronologically.
 */
export async function fetchBackupsHistory(): Promise<BackupInfo[]> {
    try {
        const token = getStorageItem<string | null>(STORAGE_KEYS.adminSession, null);
        const headers: Record<string, string> = {};
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const res = await fetch('/api/backups', {
            headers,
            credentials: 'include'
        });

        if (res.ok) {
            return (await res.json()) as BackupInfo[];
        }
    } catch {
        // ignore
    }
    return [];
}

/**
 * Requests the backend to roll back `links.json` to the specified backup snapshot.
 * Requires administrator authentication.
 *
 * @param filename - Target backup filename (e.g. "links_20260915_120000.json").
 * @returns Result object with `success: true` or `error` message string.
 */
export async function rollbackLinksBackup(filename: string): Promise<{ success: boolean; error?: string }> {
    try {
        const token = getStorageItem<string | null>(STORAGE_KEYS.adminSession, null);
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const res = await fetch('/api/backups/rollback', {
            method: 'POST',
            headers,
            credentials: 'include',
            body: JSON.stringify({ filename })
        });

        if (!res.ok) {
            const data = (await res.json().catch(() => ({}))) as { error?: string };
            return { success: false, error: data.error || `Помилка відновлення (HTTP ${res.status})` };
        }

        return { success: true };
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, error: `Не вдалося відновити з бекапу: ${msg}` };
    }
}
