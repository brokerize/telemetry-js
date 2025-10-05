import { describe, it, expect } from 'vitest';
import {
    setTracingMode,
    getTracingMode,
    getEnableSpanLimits,
    setEnableSpanLimits,
    maybeWarnLegacy
} from '../../src/tracing/tracing-config.ts';

describe('Tracing-Config Flags', () => {
    it('set/getTracingMode', () => {
        setTracingMode('natural-sync-async');
        expect(getTracingMode()).toBe('natural-sync-async');
        setTracingMode('legacy-always-promise');
        expect(getTracingMode()).toBe('legacy-always-promise');
    });

    it('Span-Limits Flag togglen', () => {
        setEnableSpanLimits(false);
        expect(getEnableSpanLimits()).toBe(false);
        setEnableSpanLimits(true);
        expect(getEnableSpanLimits()).toBe(true);
    });

    it('maybeWarnLegacy - ruft warn jeweils max. 1x pro Thema', () => {
        const logs: string[] = [];
        const fakeDiag = {
            warn: (...a: any[]) => logs.push(a.join(' '))
        };
        setTracingMode('legacy-always-promise');
        setEnableSpanLimits(false);

        maybeWarnLegacy(fakeDiag as any);

        maybeWarnLegacy(fakeDiag as any);

        expect(logs.some((l) => l.includes('Legacy mode active'))).toBe(true);
        expect(logs.some((l) => l.includes('Span limits are disabled'))).toBe(true);

        const legacyCount = logs.filter((l) => l.includes('Legacy mode active')).length;
        const limitsCount = logs.filter((l) => l.includes('Span limits are disabled')).length;
        expect(legacyCount).toBe(1);
        expect(limitsCount).toBe(1);
    });
});
