import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import {
    getCookie,
    setCookie,
    deleteCookie,
    getStorageItem,
    setStorageItem,
    removeStorageItem,
    loadHiddenSubjects,
    saveHiddenSubjects,
    clearHiddenSubjects,
    loadShowHideControls,
    saveShowHideControls
} from './storage';
import { STORAGE_KEYS } from './constants';

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
let cookieJar: Record<string, string> = {};

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalLocalStorage = globalThis.localStorage;

describe('storage module', () => {
    beforeEach(() => {
        cookieJar = {};
        mockLocalStorage.clear();

        globalThis.window = globalThis as unknown as Window & typeof globalThis;
        // @ts-expect-error Mocking localStorage
        globalThis.localStorage = mockLocalStorage;

        globalThis.document = {
            get cookie() {
                return Object.entries(cookieJar)
                    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
                    .join('; ');
            },
            set cookie(str: string) {
                const parts = str.split(';');
                const firstPart = parts[0] || '';
                const eqIdx = firstPart.indexOf('=');
                if (eqIdx !== -1) {
                    const key = decodeURIComponent(firstPart.slice(0, eqIdx).trim());
                    const val = decodeURIComponent(firstPart.slice(eqIdx + 1).trim());
                    const expiresPart = parts.find((p) => p.trim().startsWith('expires='));
                    if (expiresPart && expiresPart.includes('1970')) {
                        delete cookieJar[key];
                    } else {
                        cookieJar[key] = val;
                    }
                }
            }
        } as unknown as Document;
    });

    afterAll(() => {
        globalThis.window = originalWindow;
        globalThis.document = originalDocument;
        globalThis.localStorage = originalLocalStorage;
    });

    describe('cookie helpers', () => {
        it('sets and retrieves a cookie', () => {
            setCookie('test_cookie', 'hello_world');
            expect(getCookie('test_cookie')).toBe('hello_world');
        });

        it('returns null for nonexistent cookie', () => {
            expect(getCookie('nonexistent')).toBeNull();
        });

        it('deletes a cookie', () => {
            setCookie('to_delete', 'value123');
            expect(getCookie('to_delete')).toBe('value123');
            deleteCookie('to_delete');
            expect(getCookie('to_delete')).toBeNull();
        });

        it('handles special characters with URI encoding', () => {
            setCookie('special', 'комп\'ютерні науки = 100%');
            expect(getCookie('special')).toBe('комп\'ютерні науки = 100%');
        });

        it('returns null when document is undefined in SSR', () => {
            // @ts-expect-error Simulating SSR
            delete globalThis.document;
            expect(getCookie('test')).toBeNull();
            expect(() => setCookie('test', '1')).not.toThrow();
            expect(() => deleteCookie('test')).not.toThrow();
        });
    });

    describe('getStorageItem & setStorageItem', () => {
        it('stores and retrieves primitive values and objects', () => {
            setStorageItem('num', 42);
            expect(getStorageItem('num', 0)).toBe(42);

            setStorageItem('obj', { a: 1, b: 'two' });
            expect(getStorageItem('obj', { a: 0, b: '' })).toEqual({ a: 1, b: 'two' });
        });

        it('returns fallback if key does not exist', () => {
            expect(getStorageItem('missing', 'fallback')).toBe('fallback');
            expect(getStorageItem('missing_list', ['default'])).toEqual(['default']);
        });

        it('returns fallback gracefully if stored JSON is corrupted', () => {
            mockLocalStorage.setItem('corrupted', '{bad json string...');
            const fallback = { safe: true };
            expect(getStorageItem('corrupted', fallback)).toBe(fallback);
        });

        it('removes item with removeStorageItem', () => {
            setStorageItem('temp', 'value');
            expect(getStorageItem('temp', '')).toBe('value');
            removeStorageItem('temp');
            expect(getStorageItem('temp', '')).toBe('');
        });

        it('handles localStorage exceptions gracefully on setItem', () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const setItemSpy = vi.spyOn(mockLocalStorage, 'setItem').mockImplementation(() => {
                throw new Error('QuotaExceededError');
            });

            expect(() => setStorageItem('fail_key', 'value')).not.toThrow();
            expect(warnSpy).toHaveBeenCalled();

            setItemSpy.mockRestore();
            warnSpy.mockRestore();
        });

        it('handles localStorage exceptions gracefully on removeItem', () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const removeItemSpy = vi.spyOn(mockLocalStorage, 'removeItem').mockImplementation(() => {
                throw new Error('SecurityError');
            });

            expect(() => removeStorageItem('fail_key')).not.toThrow();
            expect(warnSpy).toHaveBeenCalled();

            removeItemSpy.mockRestore();
            warnSpy.mockRestore();
        });

        it('handles SSR when window or localStorage is undefined', () => {
            // @ts-expect-error Simulating SSR
            delete globalThis.window;
            // @ts-expect-error Simulating SSR
            delete globalThis.localStorage;

            expect(getStorageItem('key', 'default')).toBe('default');
            expect(() => setStorageItem('key', 'val')).not.toThrow();
            expect(() => removeStorageItem('key')).not.toThrow();
        });
    });

    describe('loadHiddenSubjects & saveHiddenSubjects', () => {
        it('saves and loads hidden subjects from localStorage', () => {
            const list = ['Вища математика', 'Фізика'];
            saveHiddenSubjects(list);
            expect(loadHiddenSubjects()).toEqual(list);
        });

        it('migrates from cookie if localStorage is empty', () => {
            const list = ['Організація баз даних'];
            setCookie(STORAGE_KEYS.hiddenSubjects, JSON.stringify(list));

            const result = loadHiddenSubjects();
            expect(result).toEqual(list);
            expect(getStorageItem<string[]>(STORAGE_KEYS.hiddenSubjects, [])).toEqual(list);
        });

        it('handles corrupted cookie json gracefully', () => {
            setCookie(STORAGE_KEYS.hiddenSubjects, '{corrupt json');
            expect(loadHiddenSubjects()).toEqual([]);
        });

        it('handles non-array cookie value gracefully', () => {
            setCookie(STORAGE_KEYS.hiddenSubjects, JSON.stringify({ not: 'an array' }));
            expect(loadHiddenSubjects()).toEqual([]);
        });

        it('returns empty array when neither localStorage nor cookie has data', () => {
            expect(loadHiddenSubjects()).toEqual([]);
        });

        it('clears hidden subjects from both localStorage and cookies', () => {
            saveHiddenSubjects(['Фізика']);
            clearHiddenSubjects();
            expect(loadHiddenSubjects()).toEqual([]);
            expect(getCookie(STORAGE_KEYS.hiddenSubjects)).toBeNull();
        });
    });

    describe('loadShowHideControls & saveShowHideControls', () => {
        it('saves and loads boolean show controls flag', () => {
            saveShowHideControls(true);
            expect(loadShowHideControls()).toBe(true);

            saveShowHideControls(false);
            expect(loadShowHideControls()).toBe(false);
        });

        it('falls back to cookie if localStorage is uninitialized', () => {
            setCookie(STORAGE_KEYS.showHideControls, 'true');
            expect(loadShowHideControls()).toBe(true);
        });

        it('defaults to false when empty', () => {
            expect(loadShowHideControls()).toBe(false);
        });
    });
});
