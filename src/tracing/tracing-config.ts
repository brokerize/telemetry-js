export type TracingMode = 'legacy-always-promise' | 'natural-sync-async';

let mode: TracingMode =
    (process.env.TRACES_MODE as TracingMode) ||
    (process.env.TRACES_LEGACY_ASYNC_WRAPPER === '1' ? 'legacy-always-promise' : 'natural-sync-async');
let enableSpanLimits = process.env.TRACES_ENABLE_LIMITS === '1' || false;
let warnOncePromise = false;
let warnOnceLimits = false;
export function setTracingMode(m: TracingMode) {
    mode = m;
}
export function getTracingMode() {
    return mode;
}
export function getEnableSpanLimits() {
    return enableSpanLimits;
}
export function setEnableSpanLimits(enable: boolean) {
    enableSpanLimits = enable;
}

export function maybeWarnLegacy(diag?: { warn: (...a: any[]) => void }) {
    if (mode === 'legacy-always-promise' && diag && !warnOncePromise) {
        warnOncePromise = true;
        diag.warn(
            '[Tracing] Legacy mode active: sync functions are wrapped into Promises. ' +
                'This behavior is deprecated; switch to TRACES_MODE=natural-sync-async.' +
                'This behavior will be removed in future versions and only natural-sync-async mode will be supported.'
        );
    }
    if (!warnOnceLimits && !enableSpanLimits && diag) {
        warnOnceLimits = true;
        diag.warn(
            '[Tracing] Span limits are disabled. This may lead to increased memory consumption. ' +
                'To enable span limits, set TRACES_ENABLE_LIMITS=1. You can set the span limits ' +
                'using the spanLimits option when initializing the SDK. Span limits are enabled by default in future versions.'
        );
    }
}
