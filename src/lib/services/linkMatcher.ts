/**
 * @fileoverview High-performance online meeting link matching engine.
 *
 * Implements:
 * 1. String normalization (case-folding, apostrophe normalization, whitespace trimming).
 * 2. $O(1)$ exact lookup Map indexing.
 * 3. Bidirectional substring fallback matching.
 * 4. In-memory memoization cache for $O(1)$ fast subsequent lookups.
 * 5. Automatic Zoom passcode embedding via query parameter (`?pwd=...`).
 */

import type { OnlineLink } from '../types';
import rawLinks from '$lib/data/links.json';

/**
 * Pre-processed, normalized link record stored in internal lookup tables.
 */
export interface FastIndexedLink {
    /** Lowercased, normalized subject title */
    titleNorm: string;
    /** Lowercased, normalized lecturer name */
    lecturerNorm: string;
    /** Ready-to-use video conference URL with embedded password */
    link: string;
    /** Optional plaintext meeting password */
    password?: string;
}

/**
 * Currently active in-memory list of online links.
 */
export let activeOnlineLinks: OnlineLink[] = [...rawLinks];

let preIndexedLinks: FastIndexedLink[] = [];
const exactMatchMap = new Map<string, FastIndexedLink>();
const searchCache = new Map<string, { link: string; password?: string } | null>();

/**
 * Normalizes an arbitrary text string for consistent matching:
 * - Converts to lower case.
 * - Standardizes all variants of Ukrainian apostrophes (`’`, `ʻ`, `` ` ``, `'`) to a single `'`.
 * - Collapses multiple spaces into single spaces and trims ends.
 *
 * @param s - Input string to normalize.
 * @returns Clean, normalized string.
 *
 * @example
 * ```ts
 * normalizeStr("Комп’ютерні  системи"); // => "комп'ютерні системи"
 * ```
 */
export function normalizeStr(s: string): string {
    return (s || '')
        .toLowerCase()
        .replace(/[\u2019\u02BC\u0060\u0027\']/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Embeds a meeting password into a Zoom meeting URL if not already present in the query string.
 *
 * @param link - Base meeting URL.
 * @param password - Meeting password/passcode string.
 * @returns Updated URL with `?pwd=` or `&pwd=` query param attached, or original link if not Zoom.
 *
 * @example
 * ```ts
 * embedPasswordIntoUrl('https://zoom.us/j/123456789', 'secret');
 * // => 'https://zoom.us/j/123456789?pwd=secret'
 * ```
 */
export function embedPasswordIntoUrl(link: string, password?: string): string {
    const trimmedLink = (link || '').trim();
    const trimmedPwd = (password || '').trim();
    if (!trimmedLink || !trimmedPwd) return trimmedLink;

    if (trimmedLink.toLowerCase().includes('zoom.us') && !trimmedLink.includes('pwd=')) {
        const separator = trimmedLink.includes('?') ? '&' : '?';
        return `${trimmedLink}${separator}pwd=${encodeURIComponent(trimmedPwd)}`;
    }
    return trimmedLink;
}

/**
 * Re-indexes in-memory links and clears lookup caches.
 * Pre-normalizes all titles and builds the $O(1)$ `exactMatchMap`.
 *
 * @param links - Array of new {@link OnlineLink} items to index.
 */
export function setActiveOnlineLinks(links: OnlineLink[]): void {
    activeOnlineLinks = [...links];
    searchCache.clear();
    exactMatchMap.clear();

    preIndexedLinks = links.map(entry => {
        const titleNorm = normalizeStr(entry.title);
        const lecturerNorm = normalizeStr(entry.lecturer || '');
        const link = embedPasswordIntoUrl(entry.link || '', entry.password);
        const item: FastIndexedLink = {
            titleNorm,
            lecturerNorm,
            link,
            password: (entry.password || '').trim() || undefined
        };

        // Populate exact index
        if (titleNorm) {
            exactMatchMap.set(`${titleNorm}|${lecturerNorm}`, item);
            if (!exactMatchMap.has(`${titleNorm}|`)) {
                exactMatchMap.set(`${titleNorm}|`, item);
            }
        }

        return item;
    });
}

/**
 * High-speed lookup function that finds the online meeting link and password
 * for a given discipline and lecturer.
 *
 * Resolves in three steps:
 * 1. **Cache Lookup**: Checks in-memory memoization cache ($O(1)$).
 * 2. **Exact Map Lookup**: Checks `exactMatchMap` with `title|lecturer` key ($O(1)$).
 * 3. **Fuzzy / Substring Fallback**: Scans pre-indexed array for substring match.
 *
 * @param title - Discipline / subject title.
 * @param lecturerName - Optional lecturer name.
 * @returns Object containing `link` and optional `password`, or `null` if no match found.
 *
 * @example
 * ```ts
 * const entry = findOnlineLinkEntry('Фізика', 'Іванов І.І.');
 * if (entry) console.log(entry.link, entry.password);
 * ```
 */
export function findOnlineLinkEntry(
    title: string,
    lecturerName?: string
): { link: string; password?: string } | null {
    const t = normalizeStr(title);
    if (!t) return null;

    const l = normalizeStr(lecturerName || '');
    const cacheKey = `${t}|${l}`;

    // 1. Fast path: Memoization cache (O(1))
    if (searchCache.has(cacheKey)) {
        return searchCache.get(cacheKey)!;
    }

    // 2. Exact match Map (O(1))
    let match = exactMatchMap.get(cacheKey) || exactMatchMap.get(`${t}|`) || null;

    // 3. Fallback: Bidirectional substring match using pre-normalized entries
    if (!match) {
        match = preIndexedLinks.find(entry => {
            if (!entry.titleNorm) return false;
            const titleMatches = t.includes(entry.titleNorm) || entry.titleNorm.includes(t);
            const lecturerMatches = !entry.lecturerNorm || !l || l.includes(entry.lecturerNorm) || entry.lecturerNorm.includes(l);
            return titleMatches && lecturerMatches;
        }) || null;
    }

    const result = match ? { link: match.link, password: match.password } : null;
    searchCache.set(cacheKey, result);
    return result;
}

/**
 * Convenience wrapper around {@link findOnlineLinkEntry} that returns just the URL string.
 *
 * @param title - Subject title.
 * @param lecturerName - Optional lecturer name.
 * @returns Meeting URL string or empty string `""` if not found.
 */
export function findOnlineLink(title: string, lecturerName?: string): string {
    const entry = findOnlineLinkEntry(title, lecturerName);
    return entry ? entry.link : '';
}

// Initialize default index with static JSON links
setActiveOnlineLinks(rawLinks);
