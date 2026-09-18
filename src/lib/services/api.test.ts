import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import {
    fetchSchedule,
    fetchServerOnlineLinks,
    loginAdmin,
    checkAdminAuth,
    logoutAdmin,
    saveLinksToServer,
    fetchBackupsHistory,
    rollbackLinksBackup
} from './api';
import { STORAGE_KEYS } from '../constants';
import { getStorageItem, setStorageItem } from '../storage';
import type { ApiScheduleResponse, OnlineLink } from '../types';

class LocalStorageMock {
    private store: Record<string, string> = {};
    getItem(key: string) {
        return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null;
    }
    setItem(key: string, value: string) {
        this.store[key] = String(value);
    }
    removeItem(key: string) {
        delete this.store[key];
    }
    clear() {
        this.store = {};
    }
}

const mockLocalStorage = new LocalStorageMock();
const originalWindow = globalThis.window;
const originalLocalStorage = globalThis.localStorage;
const originalFetch = globalThis.fetch;

describe('api module', () => {
    beforeEach(() => {
        mockLocalStorage.clear();
        globalThis.window = {
            ...globalThis,
            __SCHEDULE_PROMISE__: undefined
        } as unknown as Window & typeof globalThis;
        // @ts-expect-error Mocking localStorage
        globalThis.localStorage = mockLocalStorage;
    });

    afterAll(() => {
        globalThis.window = originalWindow;
        globalThis.localStorage = originalLocalStorage;
        globalThis.fetch = originalFetch;
    });

    describe('fetchSchedule', () => {
        const mockApiResponse: ApiScheduleResponse = {
            scheduleFirstWeek: [
                {
                    day: 'Пн',
                    pairs: [
                        {
                            name: 'Алгоритми та структури даних',
                            type: 'Лек',
                            lecturer: { name: 'Коваленко К.К.' },
                            time: '08:30',
                            location: { title: '101' }
                        }
                    ]
                }
            ],
            scheduleSecondWeek: []
        };

        it('fetches and transforms schedule from remote endpoint', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => mockApiResponse
            });

            const result = await fetchSchedule('https://api.schedule.test/kpi', mockFetch as unknown as typeof fetch);

            expect(mockFetch).toHaveBeenCalledWith('https://api.schedule.test/kpi');
            expect(result.week1.mon[1]).toBeDefined();
            expect(result.week1.mon[1]?.[0]?.title).toBe('Алгоритми та структури даних');
            expect(result.week1.mon[1]?.[0]?.type).toBe(1); // 1 = lecture

            // Verify cached in localStorage
            const cached = getStorageItem(STORAGE_KEYS.scheduleCache, null);
            expect(cached).not.toBeNull();
        });

        it('consumes early window.__SCHEDULE_PROMISE__ if present in head', async () => {
            window.__SCHEDULE_PROMISE__ = Promise.resolve(mockApiResponse);
            const mockFetch = vi.fn();

            const result = await fetchSchedule('https://api.schedule.test/kpi', mockFetch as unknown as typeof fetch);

            expect(mockFetch).not.toHaveBeenCalled();
            expect(result.week1.mon[1]?.[0]?.title).toBe('Алгоритми та структури даних');
            expect(window.__SCHEDULE_PROMISE__).toBeUndefined();
        });

        it('falls back to fetch if window.__SCHEDULE_PROMISE__ rejects', async () => {
            window.__SCHEDULE_PROMISE__ = Promise.reject(new Error('Head fetch failed'));
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => mockApiResponse
            });

            const result = await fetchSchedule('https://api.schedule.test/kpi', mockFetch as unknown as typeof fetch);

            expect(mockFetch).toHaveBeenCalled();
            expect(result.week1.mon[1]?.[0]?.title).toBe('Алгоритми та структури даних');
        });

        it('throws error when server responds with non-200 HTTP status', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 502
            });

            await expect(
                fetchSchedule('https://api.schedule.test/kpi', mockFetch as unknown as typeof fetch)
            ).rejects.toThrow('HTTP помилка: 502');
        });

        it('throws error when response contains malformed empty data', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({})
            });

            await expect(
                fetchSchedule('https://api.schedule.test/kpi', mockFetch as unknown as typeof fetch)
            ).rejects.toThrow('Отримано порожню або некоректну відповідь від API');
        });
    });

    describe('fetchServerOnlineLinks', () => {
        it('fetches links with 200 OK and stores ETag', async () => {
            const links: OnlineLink[] = [{ title: 'Математика', link: 'https://zoom.us/j/123' }];
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                headers: new Headers({ ETag: '"etag-12345"' }),
                json: async () => links
            });

            const result = await fetchServerOnlineLinks('/api/links');

            expect(result).toEqual(links);
            expect(getStorageItem(STORAGE_KEYS.onlineLinksETag, null)).toBe('"etag-12345"');
        });

        it('returns null on 304 Not Modified when ETag matches', async () => {
            setStorageItem(STORAGE_KEYS.onlineLinksETag, '"current-etag"');
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 304
            });

            const result = await fetchServerOnlineLinks('/api/links');

            expect(result).toBeNull();
            expect(globalThis.fetch).toHaveBeenCalledWith(
                '/api/links',
                expect.objectContaining({
                    headers: { 'If-None-Match': '"current-etag"' }
                })
            );
        });

        it('returns null on network failure without throwing', async () => {
            globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network disconnected'));

            const result = await fetchServerOnlineLinks('/api/links');
            expect(result).toBeNull();
        });
    });

    describe('loginAdmin', () => {
        it('stores session token on successful login', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ success: true, token: 'session-xyz-789' })
            });

            const res = await loginAdmin('secret123');

            expect(res).toEqual({ success: true });
            expect(getStorageItem(STORAGE_KEYS.adminSession, null)).toBe('session-xyz-789');
        });

        it('returns error message on invalid password (401)', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 401,
                json: async () => ({ error: 'Невірний пароль адміністратора' })
            });

            const res = await loginAdmin('wrongpass');

            expect(res.success).toBe(false);
            expect(res.error).toBe('Невірний пароль адміністратора');
        });

        it('handles network error gracefully', async () => {
            globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

            const res = await loginAdmin('secret123');

            expect(res.success).toBe(false);
            expect(res.error).toContain('Connection refused');
        });
    });

    describe('checkAdminAuth & logoutAdmin', () => {
        it('checkAdminAuth returns true when backend responds authenticated: true', async () => {
            setStorageItem(STORAGE_KEYS.adminSession, 'token-123');
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ authenticated: true })
            });

            const isAuth = await checkAdminAuth();
            expect(isAuth).toBe(true);
            expect(globalThis.fetch).toHaveBeenCalledWith(
                '/api/auth/check',
                expect.objectContaining({
                    headers: { Authorization: 'Bearer token-123' }
                })
            );
        });

        it('checkAdminAuth returns false on unauthenticated or error', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ authenticated: false })
            });

            expect(await checkAdminAuth()).toBe(false);
        });

        it('logoutAdmin calls backend and clears token from storage', async () => {
            setStorageItem(STORAGE_KEYS.adminSession, 'token-to-clear');
            globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });

            await logoutAdmin();

            expect(globalThis.fetch).toHaveBeenCalledWith(
                '/api/auth/logout',
                expect.objectContaining({ method: 'POST' })
            );
            expect(getStorageItem(STORAGE_KEYS.adminSession, null)).toBeNull();
        });
    });

    describe('saveLinksToServer', () => {
        it('saves links successfully and updates ETag', async () => {
            setStorageItem(STORAGE_KEYS.adminSession, 'valid-session');
            const links: OnlineLink[] = [{ title: 'Фізика', link: 'https://meet.google.com/abc' }];

            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                headers: new Headers({ ETag: '"new-etag"' }),
                json: async () => ({ success: true, count: 1 })
            });

            const res = await saveLinksToServer(links);

            expect(res.success).toBe(true);
            expect(getStorageItem(STORAGE_KEYS.onlineLinksETag, null)).toBe('"new-etag"');
        });

        it('returns unauthorized error on 401', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 401
            });

            const res = await saveLinksToServer([]);
            expect(res.success).toBe(false);
            expect(res.error).toContain('Потрібна авторизація');
        });

        it('handles server non-200 non-401 response and network exceptions', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 500,
                json: async () => ({ error: 'Internal server error' })
            });

            const res = await saveLinksToServer([], 'fallback-pass');
            expect(res.success).toBe(false);
            expect(res.error).toBe('Internal server error');

            globalThis.fetch = vi.fn().mockRejectedValue(new Error('Save failed'));
            const resErr = await saveLinksToServer([]);
            expect(resErr.success).toBe(false);
            expect(resErr.error).toContain('Save failed');
        });
    });

    describe('fetchBackupsHistory & rollbackLinksBackup', () => {
        it('fetchBackupsHistory returns backup descriptors and handles network error', async () => {
            setStorageItem(STORAGE_KEYS.adminSession, 'session-token');
            const backups = [{ filename: 'links_20260915_120000.json', createdAt: '15.09.2026', size: 1024 }];

            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => backups
            });

            const list = await fetchBackupsHistory();
            expect(list).toEqual(backups);

            globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
            expect(await fetchBackupsHistory()).toEqual([]);
        });

        it('rollbackLinksBackup sends filename and returns success', async () => {
            setStorageItem(STORAGE_KEYS.adminSession, 'session-token');
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ success: true, count: 10 })
            });

            const res = await rollbackLinksBackup('links_20260915_120000.json');
            expect(res.success).toBe(true);
            expect(globalThis.fetch).toHaveBeenCalledWith(
                '/api/backups/rollback',
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({ filename: 'links_20260915_120000.json' })
                })
            );
        });

        it('rollbackLinksBackup returns server error message on failure and handles exceptions', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 400,
                json: async () => ({ error: 'Некоректне ім\'я файлу бекапу' })
            });

            const res = await rollbackLinksBackup('bad-file.txt');
            expect(res.success).toBe(false);
            expect(res.error).toBe('Некоректне ім\'я файлу бекапу');

            globalThis.fetch = vi.fn().mockRejectedValue(new Error('Rollback failed'));
            const resErr = await rollbackLinksBackup('links_20260915_120000.json');
            expect(resErr.success).toBe(false);
            expect(resErr.error).toContain('Rollback failed');
        });
    });
});
