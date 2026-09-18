import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { initDiagnostics } from './diagnostics';

describe('diagnostics module', () => {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;

    beforeEach(() => {
        vi.restoreAllMocks();
    });

    afterAll(() => {
        globalThis.window = originalWindow;
        globalThis.document = originalDocument;
    });

    it('handles SSR gracefully when window is undefined', () => {
        // @ts-expect-error Simulating SSR
        delete globalThis.window;
        expect(() => initDiagnostics()).not.toThrow();
    });

    it('initializes and triggers collection in browser environment with requestIdleCallback', async () => {
        const toggleTestMode = vi.fn();
        const mockWindow = {
            location: { origin: 'http://localhost:3000' },
            requestIdleCallback: (cb: () => void) => {
                cb();
                return 1;
            },
            addEventListener: vi.fn(),
            __toggleTestMode: toggleTestMode,
            performance: {
                getEntriesByType: vi.fn().mockReturnValue([
                    {
                        domainLookupEnd: 10,
                        domainLookupStart: 5,
                        connectEnd: 20,
                        connectStart: 10,
                        responseStart: 30,
                        requestStart: 20,
                        responseEnd: 40,
                        domInteractive: 50,
                        domComplete: 70,
                        loadEventEnd: 80,
                        startTime: 0
                    }
                ]),
                now: () => 100
            },
            screen: { width: 1920, height: 1080, colorDepth: 24 },
            devicePixelRatio: 2,
            navigator: {
                userAgent: 'Mozilla/5.0 Vitest',
                platform: 'Win32',
                language: 'uk-UA',
                hardwareConcurrency: 8,
                onLine: true,
                connection: {
                    rtt: 50,
                    effectiveType: '4g'
                }
            }
        };

        const mockDocument = {
            readyState: 'complete',
            referrer: 'https://test.com'
        };

        globalThis.window = mockWindow as unknown as Window & typeof globalThis;
        globalThis.document = mockDocument as unknown as Document;
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            headers: new Headers({ 'x-test': 'ok' })
        });

        initDiagnostics(() => ({ hiddenSubjectsCount: 2, linksCount: 15 }));

        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(mockWindow).toHaveProperty('__DIAGNOSTICS__');
        expect(mockWindow).toHaveProperty('__printDiagnostics');
        expect(mockWindow).toHaveProperty('__exportDiagnostics');

        // Test window.test getter
        // @ts-expect-error test property getter
        expect(mockWindow.test).toBe('Тест-режим перемкнено');
        expect(toggleTestMode).toHaveBeenCalled();

        // Test window.diag getter
        // @ts-expect-error diag property getter
        expect(mockWindow.diag).toBe('Оновлення діагностики...');

        // Test export diagnostics JSON stringify
        // @ts-expect-error test function added dynamically
        const exportedJson = mockWindow.__exportDiagnostics();
        expect(typeof exportedJson).toBe('string');
        const parsed = JSON.parse(exportedJson);
        expect(parsed).toHaveProperty('timings');
        expect(parsed).toHaveProperty('statuses');
        expect(parsed.statuses.linksCount).toBe(15);
    });

    it('falls back to setTimeout when requestIdleCallback is absent and document is loading', async () => {
        let loadHandler: (() => void) | null = null;
        const mockWindow = {
            location: { origin: 'http://localhost:3000' },
            addEventListener: vi.fn((event: string, handler: () => void) => {
                if (event === 'load') loadHandler = handler;
            }),
            performance: {
                getEntriesByType: vi.fn().mockReturnValue([]),
                now: () => 50
            },
            screen: { width: 1024, height: 768, colorDepth: 16 },
            devicePixelRatio: 1,
            navigator: {
                userAgent: 'Mobile Safari',
                platform: 'iPhone',
                language: 'en-US',
                hardwareConcurrency: 4,
                onLine: false
            }
        };

        const mockDocument = {
            readyState: 'loading',
            referrer: ''
        };

        globalThis.window = mockWindow as unknown as Window & typeof globalThis;
        globalThis.document = mockDocument as unknown as Document;
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

        initDiagnostics();

        expect(mockWindow.addEventListener).toHaveBeenCalledWith('load', expect.any(Function), { once: true });

        // Trigger load event
        if (loadHandler) {
            (loadHandler as () => void)();
        }

        await new Promise((resolve) => setTimeout(resolve, 600));

        expect(mockWindow).toHaveProperty('__DIAGNOSTICS__');
    });
});
