/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, prerendered, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

// Unique cache keys based on deployment version
const CACHE_STATIC = `schedule-static-${version}`;
const CACHE_RUNTIME = `schedule-runtime-${version}`;

// Assets to cache immediately on install
const PRECACHE_ASSETS = [
	...build,
	...files,
	...prerendered,
	'/'
];

// Helper to check if a URL is an asset generated during build
const STATIC_ASSETS_SET = new Set(PRECACHE_ASSETS);

/**
 * Service Worker Installation:
 * Pre-caches all essential static assets, JS bundles, and the root shell.
 */
sw.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE_STATIC);
			// Use allSettled so one missing non-critical file doesn't fail the entire SW install
			await Promise.allSettled(
				PRECACHE_ASSETS.map(async (url) => {
					try {
						await cache.add(url);
					} catch (err) {
						console.warn(`[ServiceWorker] Failed to precache: ${url}`, err);
					}
				})
			);
			await sw.skipWaiting();
		})()
	);
});

/**
 * Service Worker Activation:
 * Cleans up outdated caches from previous versions and claims active clients immediately.
 */
sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const keys = await caches.keys();
			await Promise.all(
				keys.map((key) => {
					if (key !== CACHE_STATIC && key !== CACHE_RUNTIME) {
						return caches.delete(key);
					}
				})
			);
			await sw.clients.claim();
		})()
	);
});

/**
 * Fetch Handler:
 * 1. Static build assets & files: Cache-first (instant response).
 * 2. API requests (/api/* and api.campus.kpi.ua): Network-first with runtime cache fallback.
 * 3. Navigation requests (HTML page): Network-first falling back to cached shell '/'.
 */
sw.addEventListener('fetch', (event) => {
	const request = event.request;

	// Only handle GET requests and http/https schemes
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

	// 1. Static Assets (Cache-First)
	if (STATIC_ASSETS_SET.has(url.pathname) || url.pathname.startsWith('/_app/')) {
		event.respondWith(
			(async () => {
				const cached = await caches.match(request);
				if (cached) return cached;

				try {
					const response = await fetch(request);
					if (response.ok) {
						const cache = await caches.open(CACHE_STATIC);
						cache.put(request, response.clone());
					}
					return response;
				} catch {
					return cached || new Response('Asset not found', { status: 404 });
				}
			})()
		);
		return;
	}

	// 2. Navigation (Page loads) - Network-first, fallback to cached root '/'
	if (request.mode === 'navigate') {
		event.respondWith(
			(async () => {
				try {
					const response = await fetch(request);
					if (response.ok) {
						const cache = await caches.open(CACHE_RUNTIME);
						cache.put(request, response.clone());
					}
					return response;
				} catch {
					const cached = await caches.match(request);
					if (cached) return cached;
					const fallback = await caches.match('/');
					if (fallback) return fallback;
					return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
				}
			})()
		);
		return;
	}

	// 3. API and Dynamic Requests - Network-first with runtime cache fallback
	if (url.pathname.startsWith('/api/') || url.hostname.includes('campus.kpi.ua')) {
		event.respondWith(
			(async () => {
				try {
					const response = await fetch(request);
					if (response.ok) {
						const cache = await caches.open(CACHE_RUNTIME);
						cache.put(request, response.clone());
					}
					return response;
				} catch {
					const cached = await caches.match(request);
					if (cached) return cached;
					return new Response(JSON.stringify({ error: 'Offline', offline: true }), {
						status: 503,
						headers: { 'Content-Type': 'application/json' }
					});
				}
			})()
		);
		return;
	}

	// 4. Default: Network with Cache Fallback
	event.respondWith(
		(async () => {
			try {
				const response = await fetch(request);
				if (response.ok) {
					const cache = await caches.open(CACHE_RUNTIME);
					cache.put(request, response.clone());
				}
				return response;
			} catch {
				const cached = await caches.match(request);
				if (cached) return cached;
				return new Response('Network error', { status: 504 });
			}
		})()
	);
});

