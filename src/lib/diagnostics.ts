import { API_URL } from './constants';
import { getLinksUpdatedAt, getScheduleUpdatedAt } from './schedule';

/**
 * Client-side performance & diagnostic logger.
 * Executes in background idle time via `requestIdleCallback` with zero load overhead.
 * Strictly focused on:
 * 1. Load Speed (Navigation Timings)
 * 2. Ping & Statuses (KPI Schedule API, Go Backend API, Network, Schedule)
 */

export interface DiagnosticData {
    timings: Record<string, string>;
    ping: {
        serverPing: string;
        kpiApiPing?: string;
        networkRtt?: string;
        connectionType?: string;
    };
    statuses: {
        network: string;
        kpiScheduleApi: string;
        backendApi: string;
        schedule: string;
        scheduleUpdatedAt: string;
        linksUpdatedAt: string;
        linksCount: number;
    };
    timestamp: string;
    mode: 'Development' | 'Production';
}

let latestDiagnostics: DiagnosticData | null = null;
let savedGetState: (() => Record<string, any>) | undefined;

/**
 * Initializes diagnostic logging in background idle time.
 */
export function initDiagnostics(getState?: () => Record<string, any>) {
    if (typeof window === 'undefined') return;
    savedGetState = getState;

    const runWhenIdle = () => {
        if ('requestIdleCallback' in window) {
            (window as any).requestIdleCallback(
                () => collectAndPrint(getState),
                { timeout: 2000 }
            );
        } else {
            setTimeout(() => collectAndPrint(getState), 500);
        }
    };

    if (document.readyState === 'complete') {
        runWhenIdle();
    } else {
        window.addEventListener('load', runWhenIdle, { once: true });
    }
}

async function collectAndPrint(getState?: () => Record<string, any>) {
    try {
        const data = await gatherData(getState);
        latestDiagnostics = data;

        if (typeof window !== 'undefined') {
            (window as any).__DIAGNOSTICS__ = data;
            (window as any).__printDiagnostics = () => collectAndPrint(savedGetState);
            (window as any).__exportDiagnostics = () => JSON.stringify(data, null, 2);

            try {
                Object.defineProperty(window, 'test', {
                    get() {
                        (window as any).__toggleTestMode?.();
                        return 'Тест-режим перемкнено';
                    },
                    configurable: true
                });
                Object.defineProperty(window, 'diag', {
                    get() {
                        (window as any).__printDiagnostics?.();
                        return 'Оновлення діагностики...';
                    },
                    configurable: true
                });
            } catch {}
        }

        printReport(data);
    } catch (err) {
        console.warn('[Diagnostics] Error collecting data:', err);
    }
}

/**
 * Accurately measures HTTP round-trip ping to the host origin/server.
 */
async function measureHttpPing(): Promise<{ pingMs: number; statusText: string; ok: boolean }> {
    const endpoints = [
        window.location.origin + '/images/favicon.svg',
        window.location.origin + '/',
        '/api/links'
    ];

    for (const url of endpoints) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);
            const start = performance.now();

            const res = await fetch(url, {
                method: 'HEAD',
                signal: controller.signal,
                cache: 'no-store'
            });
            const pingMs = Math.round(performance.now() - start);

            clearTimeout(timeoutId);
            const isOk = res.ok || res.status === 304;
            return { pingMs, statusText: `HTTP ${res.status}`, ok: isOk };
        } catch {
            continue;
        }
    }

    return { pingMs: -1, statusText: 'Недоступно', ok: false };
}

/**
 * Probes the official KPI Schedule API.
 */
async function probeKpiScheduleApi(): Promise<{ status: string; pingMs: number }> {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        const start = performance.now();

        const res = await fetch(API_URL, {
            signal: controller.signal,
            cache: 'no-store'
        });
        const pingMs = Math.round(performance.now() - start);
        clearTimeout(timeoutId);

        return {
            status: res.ok ? `Online (HTTP ${res.status})` : `Помилка (HTTP ${res.status})`,
            pingMs
        };
    } catch {
        return {
            status: 'Offline (недоступний)',
            pingMs: -1
        };
    }
}

/**
 * Probes the Go backend API (/api/links).
 */
async function probeBackendApi(): Promise<string> {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1500);
        const res = await fetch('/api/links', {
            signal: controller.signal,
            cache: 'no-store'
        });
        clearTimeout(timeoutId);
        return (res.ok || res.status === 304) ? `Online (HTTP ${res.status})` : `Помилка (HTTP ${res.status})`;
    } catch {
        return 'Офлайн (локальний Go-сервер не відповідає)';
    }
}

async function gatherData(getState?: () => Record<string, any>): Promise<DiagnosticData> {
    const isDev = import.meta.env.DEV;

    // 1. Page load timings (Navigation Timing API)
    const timings: Record<string, string> = {};
    const navEntries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    if (navEntries.length > 0) {
        const nav = navEntries[0];
        timings['DNS Lookup'] = `${Math.round(nav.domainLookupEnd - nav.domainLookupStart)} ms`;
        timings['TCP Handshake'] = `${Math.round(nav.connectEnd - nav.connectStart)} ms`;
        timings['TTFB (Time to First Byte)'] = `${Math.round(nav.responseStart - nav.requestStart)} ms`;
        timings['Download Content'] = `${Math.round(nav.responseEnd - nav.responseStart)} ms`;
        timings['DOM Interactive'] = `${Math.round(nav.domInteractive)} ms`;
        timings['DOM Complete'] = `${Math.round(nav.domComplete)} ms`;
        timings['Total Page Load'] = `${Math.round(nav.loadEventEnd || performance.now())} ms`;
    } else {
        timings['Total Runtime'] = `${Math.round(performance.now())} ms`;
    }

    // 2. Parallel network & API probes
    const [httpPing, kpiApiResult, backendStatus] = await Promise.all([
        measureHttpPing(),
        probeKpiScheduleApi(),
        probeBackendApi()
    ]);

    const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    const networkRtt = conn?.rtt ? `${conn.rtt} ms` : undefined;
    const connectionType = conn?.effectiveType ? String(conn.effectiveType).toUpperCase() : undefined;

    const serverPingStr = httpPing.pingMs >= 0
        ? `${httpPing.pingMs} ms`
        : (networkRtt ? `${networkRtt}` : 'N/A');

    const kpiPingStr = kpiApiResult.pingMs >= 0 ? `${kpiApiResult.pingMs} ms` : 'N/A';

    // 3. State & local update timestamps
    const state = getState ? getState() : {};
    const linksCount = state.linksCount ?? 0;
    const scheduleStatus = `Завантажено (${linksCount} посилань)`;
    const linksUpdatedAt = getLinksUpdatedAt() || 'Не збережено';
    const scheduleUpdatedAt = getScheduleUpdatedAt() || 'Не збережено';

    return {
        timings,
        ping: {
            serverPing: serverPingStr,
            kpiApiPing: kpiPingStr,
            networkRtt,
            connectionType
        },
        statuses: {
            network: navigator.onLine ? 'Online' : 'Offline',
            kpiScheduleApi: kpiApiResult.status,
            backendApi: backendStatus,
            schedule: scheduleStatus,
            scheduleUpdatedAt,
            linksUpdatedAt,
            linksCount
        },
        timestamp: new Date().toLocaleTimeString(),
        mode: isDev ? 'Development' : 'Production'
    };
}

/**
 * Returns green for valid ping and yellow for N/A or unavailable ping.
 */
function getPingStyle(ping?: string): string {
    if (!ping || ping === 'N/A' || ping === 'Н/Д' || ping === '-' || ping.includes('Недоступно')) {
        return 'color: #eab308; font-weight: bold;';
    }
    return 'color: #16a34a; font-weight: bold;';
}

/**
 * Returns green for < 500ms, yellow for 500-1000ms, red for > 1000ms.
 */
function getTimingStyle(timeStr: string): string {
    const num = parseFloat(timeStr);
    if (isNaN(num)) return '';
    if (num > 1000) {
        return 'color: #dc2626; font-weight: bold;';
    }
    if (num >= 500) {
        return 'color: #eab308; font-weight: bold;';
    }
    return 'color: #16a34a; font-weight: bold;';
}

/**
 * Clean console output without square brackets or unnecessary colors.
 * Merges Ping & Statuses into one unified table, with statuses & pings colored in green (yellow if N/A).
 */
function printReport(data: DiagnosticData) {
    // Header
    console.log(
        `%c${data.mode} ${data.timestamp}`,
        'font-weight: bold;'
    );

    // 1. Load Speed (Timings) line by line with dynamic colors
    console.groupCollapsed('Швидкість завантаження');
    for (const [name, timeStr] of Object.entries(data.timings)) {
        console.log(
            `${name}: %c${timeStr}`,
            getTimingStyle(timeStr)
        );
    }
    console.groupEnd();

    // 2. Unified Statuses and Ping Table
    console.groupCollapsed('Статуси та пінг');

    const networkPing = data.ping.networkRtt || 'N/A';
    const kpiPing = data.ping.kpiApiPing || 'N/A';
    const serverPing = data.ping.serverPing || 'N/A';


    // Highlighted lines with green statuses & green (or yellow if N/A) pings
    console.log(
        `Мережа: %c${data.statuses.network}%c • RTT: %c${networkPing}`,
        data.statuses.network === 'Online' ? 'color: #16a34a; font-weight: bold;' : 'color: #dc2626; font-weight: bold;',
        '',
        getPingStyle(networkPing)
    );
    console.log(
        `API Розкладу КПІ: %c${data.statuses.kpiScheduleApi}%c • Пінг: %c${kpiPing}`,
        data.statuses.kpiScheduleApi.includes('Online') ? 'color: #16a34a; font-weight: bold;' : 'color: #dc2626; font-weight: bold;',
        '',
        getPingStyle(kpiPing)
    );
    console.log(
        `Backend API: %c${data.statuses.backendApi}%c • Пінг: %c${serverPing}`,
        data.statuses.backendApi.includes('Online') ? 'color: #16a34a; font-weight: bold;' : 'color: #dc2626; font-weight: bold;',
        '',
        getPingStyle(serverPing)
    );
    console.log(`Розклад: ${data.statuses.schedule} • Оновлено: ${data.statuses.scheduleUpdatedAt}`);
    console.log(`Посилання: ${data.statuses.linksCount} збережено • Оновлено: ${data.statuses.linksUpdatedAt}`);
    console.groupEnd();

    console.log(`Викличте window.__printDiagnostics() у консолі для оновлення даних.`);
    console.log(`Викличте window.__toggleTestMode(true) у консолі для увімкнення тестового режиму.`);

        const testUrl = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}?test` : '?test';
    console.log(`Посилання на тестовий режим: ${testUrl}`);
}
