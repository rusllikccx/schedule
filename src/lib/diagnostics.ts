/**
 * @fileoverview Zero-overhead diagnostic performance and network health monitor.
 *
 * Runs strictly during idle browser time via `requestIdleCallback`.
 * Measures:
 * 1. Navigation Timing Metrics (DNS, TCP handshake, TTFB, DOM Interactive, DOM Complete, Total Page Load).
 * 2. Parallel network and latency probes (Origin HTTP ping, KPI Campus API ping, Go Backend ping, Network RTT).
 * 3. Schedule and online meeting link cache freshness timestamps.
 * 4. Outputs a styled, organized console diagnostic dashboard for developers.
 */

import { API_URL } from './constants';
import { getLinksUpdatedAt, getScheduleUpdatedAt } from './services/scheduleService';

/**
 * Diagnostic metrics snapshot payload.
 */
export interface DiagnosticData {
    /** Navigation and page load timing breakdown in milliseconds */
    timings: Record<string, string>;
    /** Latency and ping metrics for network and remote APIs */
    ping: {
        serverPing: string;
        kpiApiPing?: string;
        networkRtt?: string;
        connectionType?: string;
    };
    /** Operational status indicators for network, Campus API, Go backend, and cached datasets */
    statuses: {
        network: string;
        kpiScheduleApi: string;
        backendApi: string;
        schedule: string;
        scheduleUpdatedAt: string;
        linksUpdatedAt: string;
        linksCount: number;
    };
    /** Localized timestamp when the report was captured */
    timestamp: string;
    /** Build environment mode ('Development' or 'Production') */
    mode: 'Development' | 'Production';
}

/**
 * State object passed to diagnostics logger.
 */
export interface DiagnosticsState {
    /** Current number of user-hidden subjects */
    hiddenSubjectsCount?: number;
    /** Current number of active online meeting links */
    linksCount?: number;
}

let latestDiagnostics: DiagnosticData | null = null;
let savedGetState: (() => DiagnosticsState) | undefined;

/**
 * Initializes the background diagnostic collector during browser idle periods.
 * Attaches global developer helper commands (`window.__printDiagnostics()`, `window.test`, `window.diag`).
 *
 * @param getState - Optional state callback providing live counts.
 */
export function initDiagnostics(getState?: () => DiagnosticsState): void {
    if (typeof window === 'undefined') return;
    savedGetState = getState;

    const runWhenIdle = () => {
        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(
                () => { void collectAndPrint(getState); },
                { timeout: 2000 }
            );
        } else {
            setTimeout(() => { void collectAndPrint(getState); }, 500);
        }
    };

    if (document.readyState === 'complete') {
        runWhenIdle();
    } else {
        window.addEventListener('load', runWhenIdle, { once: true });
    }
}

/**
 * Gathers performance data and prints the formatted dashboard to the browser console.
 */
async function collectAndPrint(getState?: () => DiagnosticsState): Promise<void> {
    try {
        const data = await gatherData(getState);
        latestDiagnostics = data;

        if (typeof window !== 'undefined') {
            window.__DIAGNOSTICS__ = data;
            window.__printDiagnostics = () => { void collectAndPrint(savedGetState); };
            window.__exportDiagnostics = () => JSON.stringify(data, null, 2);

            try {
                Object.defineProperty(window, 'test', {
                    get() {
                        window.__toggleTestMode?.();
                        return 'Тест-режим перемкнено';
                    },
                    configurable: true
                });
                Object.defineProperty(window, 'diag', {
                    get() {
                        window.__printDiagnostics?.();
                        return 'Оновлення діагностики...';
                    },
                    configurable: true
                });
            } catch {
                // ignore
            }
        }

        printReport(data);
    } catch (err) {
        console.warn('[Diagnostics] Error collecting data:', err);
    }
}

/**
 * Measures round-trip HTTP ping to the host origin using `HEAD` requests.
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
 * Probes the official KPI Schedule API to verify connectivity and measure latency.
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
 * Probes the local Go backend API (`/api/links`) for availability.
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

/**
 * Collects Navigation Timing metrics and executes parallel network probes.
 */
async function gatherData(getState?: () => DiagnosticsState): Promise<DiagnosticData> {
    const isDev = import.meta.env.DEV;

    // 1. Page load timings (Navigation Timing API)
    const timings: Record<string, string> = {};
    const navEntries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    if (navEntries.length > 0) {
        const nav = navEntries[0]!;
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

    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
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
 * Returns dynamic color style for ping values (green for available, yellow for N/A).
 */
function getPingStyle(ping?: string): string {
    if (!ping || ping === 'N/A' || ping === 'Н/Д' || ping === '-' || ping.includes('Недоступно')) {
        return 'color: #eab308; font-weight: bold;';
    }
    return 'color: #16a34a; font-weight: bold;';
}

/**
 * Returns dynamic color style for timing metrics (green < 500ms, yellow < 1000ms, red > 1000ms).
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
 * Outputs structured, color-coded diagnostic logs into the browser console.
 */
function printReport(data: DiagnosticData): void {
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
