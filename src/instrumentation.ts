import { diag, DiagConsoleLogger, DiagLogLevel, trace, context, propagation } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { ExportResultCode } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import type { SpanExporter, SpanLimits, SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { BatchSpanProcessor, ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';
import {
    setTracingMode,
    TracingMode,
    getEnableSpanLimits,
    setEnableSpanLimits,
    maybeWarnLegacy
} from './tracing/tracing-config.ts';

diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);

let sdk: NodeSDK | undefined;
let contextManager: AsyncLocalStorageContextManager | undefined;
let createdTraceExporter: SpanExporter | undefined;
let effectiveSpanProcessors: SpanProcessor[] | undefined;

const NOOP_EXPORTER_FLAG = '__brokerize_noop_exporter__' as const;
type NoopFlagged = { [NOOP_EXPORTER_FLAG]?: true };

/**
 * Declarative configuration for the span exporter used by `initInstrumentation`.
 *
 * - Pass a **concrete `SpanExporter`** instance for full control.
 * - Or use a **descriptor** to let this library construct a sensible default exporter.
 *
 * @example
 * // Full control (you build processors yourself):
 * initInstrumentation({
 *   serviceName: 'svc',
 *   spanProcessors: [
 *     new BatchSpanProcessor(new OTLPTraceExporter({ url: 'http://otel:4318/v1/traces' }))
 *   ]
 * });
 *
 * @example
 * // Simple path (let the lib build a BatchSpanProcessor for you):
 * initInstrumentation({
 *   serviceName: 'svc',
 *   exporter: { kind: 'otlp', url: 'http://otel:4318/v1/traces' }
 * });
 */
export type ExporterInput =
    | SpanExporter
    | { kind: 'otlp'; url: string; concurrencyLimit?: number; headers?: Record<string, string> }
    | { kind: 'console' }
    | { kind: 'noop' }
    | undefined;

function makeNoopExporter(): SpanExporter & NoopFlagged {
    const e: SpanExporter & NoopFlagged = {
        export: (_spans, cb) => cb({ code: ExportResultCode.SUCCESS }),
        shutdown: async () => {},
        forceFlush: async () => {}
    };
    e[NOOP_EXPORTER_FLAG] = true;
    return e;
}

function resolveExporter(opts: {
    exporter?: ExporterInput;
    url?: string;
    localDebugging?: boolean;
    concurrencyLimit?: number;
    headers?: Record<string, string>;
}): SpanExporter | undefined {
    if (opts.exporter) {
        if (typeof (opts.exporter as any).export === 'function') {
            return opts.exporter as SpanExporter;
        }
        const e = opts.exporter as Exclude<ExporterInput, SpanExporter>;
        switch (e!.kind) {
            case 'console':
                diag.info('Using ConsoleSpanExporter (explicit)');
                return new ConsoleSpanExporter();
            case 'noop':
                diag.info('Using Noop SpanExporter (explicit)');
                return makeNoopExporter();
            case 'otlp': {
                const { url, concurrencyLimit = 10, headers } = e!;
                diag.info('Using OTLPTraceExporter (explicit)');
                const headerNames = headers ? Object.keys(headers) : [];
                diag.info('collectorOptions: ' + JSON.stringify({ url, concurrencyLimit, headerNames }));
                return new OTLPTraceExporter({ url, concurrencyLimit, headers });
            }
        }
    }

    if (!opts.localDebugging && !opts.url) {
        diag.info('No exporter configured (legacy) → Noop exporter');
        return makeNoopExporter();
    }
    if (opts.localDebugging) {
        diag.info('Using ConsoleSpanExporter (legacy localDebugging)');
        return new ConsoleSpanExporter();
    }
    const url = opts.url!;
    const concurrencyLimit = opts.concurrencyLimit ?? 10;
    diag.info('Using OTLPTraceExporter (legacy)');
    diag.info('collectorOptions: ' + JSON.stringify({ url, concurrencyLimit }));
    return new OTLPTraceExporter({ url, concurrencyLimit });
}

function resolveSpanProcessors(
    exporter: (SpanExporter & Partial<NoopFlagged>) | undefined,
    provided: SpanProcessor[] | undefined
): SpanProcessor[] | undefined {
    if (Array.isArray(provided) && provided.length > 0) {
        return provided;
    }

    if (!exporter) return undefined;

    if ((exporter as NoopFlagged)[NOOP_EXPORTER_FLAG]) {
        return undefined;
    }

    diag.info('Using default BatchSpanProcessor');
    return [
        new BatchSpanProcessor(exporter, {
            maxQueueSize: 1000,
            scheduledDelayMillis: 5000
        })
    ];
}

/**
 * Options for {@link initInstrumentation}.
 *
 * @remarks
 * **Precedence & behavior**
 *
 * 1. If you provide **`spanProcessors`**, those processors are used **as-is**.
 *    The library does **not** auto-attach any exporter/processor.
 * 2. If you do **not** provide `spanProcessors` but provide an **`exporter`** (or legacy `url`/`localDebugging`),
 *    the library will create a **`BatchSpanProcessor`** for you (except for `noop`).
 * 3. If neither `spanProcessors` nor exporter info is provided, tracing behaves as **No-Op** (spans not exported).
 */
export interface InitOptions {
    /**
     * Logical service name used in resource attributes and tracing.
     */
    serviceName: string;

    /**
     * Preferred way to configure the exporter (or provide a concrete `SpanExporter`).
     * If omitted, legacy flags (`url`, `localDebugging`) are considered.
     */
    exporter?: ExporterInput;

    /**
     * Legacy: OTLP endpoint used to construct an `OTLPTraceExporter`.
     * Ignored if `exporter` or `spanProcessors` is provided.
     * @deprecated Use {@link InitOptions.exporter} with `{ kind: 'otlp', url }`
     */
    url?: string;

    /**
     * Legacy: when `true`, use a `ConsoleSpanExporter` for local debugging.
     * Ignored if `exporter` or `spanProcessors` is provided.
     * @deprecated Use {@link InitOptions.exporter} with `{ kind: 'console' }`
     */
    localDebugging?: boolean;

    /**
     * Legacy: concurrency limit for the legacy OTLP exporter.
     * Only applies when using {@link InitOptions.url}.
     * @deprecated Use {@link InitOptions.exporter} with `{ kind: 'otlp', concurrencyLimit }`
     */
    concurrencyLimit?: number;

    /**
     * Auto-instrumentations to enable (e.g., HttpInstrumentation).
     */
    instrumentations?: any[];

    /**
     * Span limits (enables limits when provided or when the env flag is set).
     * If you pass this object, span limits are turned on automatically.
     */
    spanLimits?: Partial<SpanLimits>;

    /**
     * Global `withTracing` mode.
     * - `'natural-sync-async'` (default): sync stays sync; async returns Promise.
     * - `'legacy-always-promise'` (deprecated): forces Promise for all wrapped calls.
     *
     * @remarks
     * The `'legacy-always-promise'` mode is intended for migration only and will log a one-time deprecation warning.
     */
    tracingMode?: TracingMode;

    /**
     * Provide custom span processor chain. If set, the library will **not** create any processor for you.
     * Recommended when you need full control over batching/queuing or want to attach multiple processors.
     *
     * @example
     * spanProcessors: [
     *   new BatchSpanProcessor(new OTLPTraceExporter({ url: '...' })),
     *   new AnotherCustomProcessor()
     * ]
     */
    spanProcessors?: SpanProcessor[];
}

/**
 * Initialize OpenTelemetry for this process (NodeSDK, context manager, exporter/processors, limits, instrumentations).
 *
 * @param options - {@link InitOptions} controlling exporter, processors, limits, mode, and instrumentations.
 * @returns An object with the created `sdk`, the effective `traceExporter`, and the resolved `spanProcessors`.
 *
 * @remarks
 * **Precedence**
 * - If `spanProcessors` is provided, they are used **as-is**; no implicit exporter/processor is added.
 * - Else, an exporter from `exporter` (preferred) or legacy `url`/`localDebugging` is resolved,
 *   and a default `BatchSpanProcessor(exporter)` is attached (except for `noop`).
 *
 * **Legacy**
 * - `url`, `localDebugging`, and `concurrencyLimit` are **deprecated**. Prefer `exporter` instead.
 * - Tracing mode `'legacy-always-promise'` is deprecated and should be used only for migration.
 *
 * **Idempotency**
 * - Intended to be called **once** per process at startup.
 * - Repeated calls without shutdown may produce multiple SDKs/processors.
 *
 * **Examples**
 * @example
 * // Simple (SDK builds BatchSpanProcessor for OTLP)
 * initInstrumentation({
 *   serviceName: 'my-svc',
 *   exporter: { kind: 'otlp', url: 'http://localhost:4318/v1/traces' }
 * });
 *
 * @example
 * // Full control (you provide processors)
 * initInstrumentation({
 *   serviceName: 'my-svc',
 *   spanProcessors: [
 *     new BatchSpanProcessor(new OTLPTraceExporter({ url: 'http://localhost:4318/v1/traces' }))
 *   ]
 * });
 *
 * @example
 * // Console exporter for local debugging
 * initInstrumentation({
 *   serviceName: 'my-svc',
 *   exporter: { kind: 'console' }
 * });
 */
export function initInstrumentation(options: InitOptions) {
    diag.info('Initializing OpenTelemetry instrumentation');
    if (options.instrumentations && options.instrumentations.length > 0) {
        diag.info('Using instrumentations:');
        options.instrumentations.forEach((instrumentation) => {
            if (instrumentation?.constructor?.name) {
                diag.info(`- ${instrumentation.constructor.name}`);
            } else {
                diag.warn('An instrumentation was provided without a valid constructor name.');
            }
        });
    } else {
        diag.info('No instrumentations specified, using none.');
    }

    contextManager = new AsyncLocalStorageContextManager().enable();

    const exporter = resolveExporter({
        exporter: options.exporter,
        url: options.url,
        localDebugging: options.localDebugging,
        concurrencyLimit: options.concurrencyLimit
    });

    const processors = resolveSpanProcessors(exporter, options.spanProcessors);

    createdTraceExporter = exporter;
    effectiveSpanProcessors = processors;

    let spanLimitOptions: SpanLimits | {} = {};
    if (options.spanLimits || getEnableSpanLimits()) {
        spanLimitOptions = {
            attributeValueLengthLimit: 12000,
            attributeCountLimit: 128,
            eventCountLimit: 128,
            linkCountLimit: 128,
            attributePerEventCountLimit: 16,
            attributePerLinkCountLimit: 16,
            ...options.spanLimits
        };
        setEnableSpanLimits(true);
        diag.info('Span limits enabled: ' + JSON.stringify(spanLimitOptions));
    }

    sdk = new NodeSDK({
        contextManager,
        serviceName: options.serviceName,
        spanProcessors: processors,
        ...(processors?.length ? {} : { traceExporter: exporter }),
        spanLimits: spanLimitOptions,
        instrumentations: options.instrumentations || []
    });

    if (options.tracingMode) setTracingMode(options.tracingMode);

    sdk.start();
    maybeWarnLegacy(diag);
    diag.info('Tracing initialized');

    return {
        sdk,
        traceExporter: createdTraceExporter,
        spanProcessors: effectiveSpanProcessors
    };
}

/** Gracefully shuts down the OpenTelemetry SDK and its components.
 * This includes flushing and shutting down the trace exporter,
 * shutting down the SDK, and disabling context propagation.
 */
export async function shutDownInstrumentation() {
    try {
        diag.info('Shutting down OpenTelemetry instrumentation');

        if (!sdk) {
            diag.warn('No OpenTelemetry SDK instance found. Nothing to shut down.');
            return;
        }

        if (!createdTraceExporter) {
            diag.warn('No trace exporter found. Nothing to shut down.');
        } else {
            if (typeof createdTraceExporter.forceFlush === 'function') {
                await createdTraceExporter.forceFlush().catch((err) => {
                    diag.warn('OTLP forceFlush failed. Ignoring and continuing shutdown.', err);
                });
            }
            await createdTraceExporter.shutdown().catch((err) => {
                diag.warn('OTLP shutdown failed. Ignoring and continuing shutdown.', err);
            });
        }

        await sdk.shutdown().catch((err) => {
            diag.warn('OpenTelemetry SDK shutdown failed. Ignoring and continuing shutdown.', err);
        });

        trace.disable();
        contextManager?.disable?.();
        propagation.disable();
        context.disable();

        createdTraceExporter = undefined;
        effectiveSpanProcessors = undefined;
        contextManager = undefined;
        sdk = undefined;

        diag.info('Instrumentation shut down successfully.');
    } catch (error) {
        diag.error('Unexpected error in shutDownInstrumentation (but process will continue):', error);
    }
}
