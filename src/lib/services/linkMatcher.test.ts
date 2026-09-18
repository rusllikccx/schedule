import { describe, it, expect, beforeEach } from 'vitest';
import {
    normalizeStr,
    embedPasswordIntoUrl,
    setActiveOnlineLinks,
    findOnlineLinkEntry,
    findOnlineLink
} from './linkMatcher';

describe('Link Matcher: normalizeStr', () => {
    it('normalizes various forms of apostrophes', () => {
        expect(normalizeStr("комп'ютер")).toBe("комп'ютер");
        expect(normalizeStr("комп’ютер")).toBe("комп'ютер");
        expect(normalizeStr("комп`ютер")).toBe("комп'ютер");
    });

    it('trims extra whitespace and converts to lowercase', () => {
        expect(normalizeStr("   Основи  Захисту   ")).toBe("основи захисту");
    });
});

describe('Link Matcher: embedPasswordIntoUrl', () => {
    it('appends ?pwd= to Zoom links without existing query params', () => {
        const url = 'https://us04web.zoom.us/j/123456789';
        expect(embedPasswordIntoUrl(url, 'secret123')).toBe('https://us04web.zoom.us/j/123456789?pwd=secret123');
    });

    it('appends &pwd= to Zoom links with existing query params', () => {
        const url = 'https://us04web.zoom.us/j/123456789?uname=test';
        expect(embedPasswordIntoUrl(url, 'secret123')).toBe('https://us04web.zoom.us/j/123456789?uname=test&pwd=secret123');
    });

    it('does not double-add pwd if already present', () => {
        const url = 'https://us04web.zoom.us/j/123456789?pwd=existing';
        expect(embedPasswordIntoUrl(url, 'secret123')).toBe('https://us04web.zoom.us/j/123456789?pwd=existing');
    });

    it('leaves non-zoom links unchanged', () => {
        const url = 'https://meet.google.com/abc-defg-hij';
        expect(embedPasswordIntoUrl(url, 'secret123')).toBe('https://meet.google.com/abc-defg-hij');
    });

    it('handles empty link or empty password safely', () => {
        expect(embedPasswordIntoUrl('', 'secret')).toBe('');
        expect(embedPasswordIntoUrl('https://zoom.us/j/123', '')).toBe('https://zoom.us/j/123');
        expect(embedPasswordIntoUrl('https://zoom.us/j/123', undefined)).toBe('https://zoom.us/j/123');
    });
});

describe('Link Matcher: Search & Fast Index', () => {
    const testLinks = [
        {
            title: 'Архітектура комп’ютерних систем',
            lecturer: 'Гальчинський Л.Ю.',
            link: 'https://zoom.us/j/11111111',
            password: '4s1s7V'
        },
        {
            title: 'Основи технологій захисту інформації',
            lecturer: 'Новіков О.М.',
            link: 'https://meet.google.com/xyz-123'
        }
    ];

    beforeEach(() => {
        setActiveOnlineLinks(testLinks);
    });

    it('finds exact match with subject and lecturer', () => {
        const result = findOnlineLinkEntry('Архітектура комп’ютерних систем', 'Гальчинський Л.Ю.');
        expect(result).not.toBeNull();
        expect(result?.link).toContain('11111111');
        expect(result?.password).toBe('4s1s7V');
    });

    it('finds match by subject substring', () => {
        const link = findOnlineLink('Архітектура комп');
        expect(link).toContain('11111111');
    });

    it('finds match by lecturer when subject has partial match', () => {
        const result = findOnlineLinkEntry('технологій захисту', 'Новіков');
        expect(result?.link).toBe('https://meet.google.com/xyz-123');
    });

    it('returns null for unknown subjects', () => {
        expect(findOnlineLinkEntry('Невідомий предмет')).toBeNull();
        expect(findOnlineLink('Невідомий предмет')).toBe('');
        expect(findOnlineLinkEntry('', '')).toBeNull();
    });

    it('handles indexing link entry with empty title safely', () => {
        setActiveOnlineLinks([{ title: '', link: 'https://example.com' }]);
        expect(findOnlineLinkEntry('Тест')).toBeNull();
    });
});
