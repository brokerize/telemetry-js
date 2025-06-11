/*instrumentation.ts*/
import { diag, DiagConsoleLogger, DiagLogLevel, trace } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import { ExportResultCode } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

import { NodeSDK } from '@opentelemetry/sdk-node';
import type { SpanExporter, SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { BatchSpanProcessor, ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';

// For troubleshooting, set the log level to DiagLogLevel.DEBUG
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);

let sdk: NodeSDK | undefined = undefined;
let contextManager: AsyncHooksContextManager | undefined = undefined;
let traceExporter: SpanExporter | undefined = undefined;
let spanProcessors: SpanProcessor[] | undefined = undefined;

function buildExporterOptions(options?: { url?: string; localDebugging?: boolean; concurrencyLimit?: number }): {
    traceExporter: SpanExporter;
    spanProcessors: SpanProcessor[] | undefined;
} {
    if (!options?.localDebugging && !options?.url) {
        /* no-op exporter for automated testing */
        return {
            traceExporter: {
                export: (spans, resultCallback) => {
                    resultCallback({
                        code: ExportResultCode.SUCCESS
                    });
                },
                shutdown: async () => {},
                forceFlush: async () => {}
            } satisfies SpanExporter,
            spanProcessors: undefined
        };
    } else if (options?.localDebugging) {
        diag.info('Using ConsoleSpanExporter');
        return {
            traceExporter: new ConsoleSpanExporter(),
            spanProcessors: undefined
        };
    } else {
        const collectorOptions = {
            url: options.url,
            concurrencyLimit: options.concurrencyLimit ?? 10
        };
        diag.info('Using OTLPTraceExporter');
        diag.info('collectorOptions: ' + JSON.stringify(collectorOptions));
        const traceExporter = new OTLPTraceExporter(collectorOptions);
        return {
            traceExporter,
            spanProcessors: [
                new BatchSpanProcessor(traceExporter, {
                    // The maximum queue size. After the size is reached spans are dropped.
                    maxQueueSize: 1000,
                    // The interval between two consecutive exports
                    scheduledDelayMillis: 5000
                })
            ]
        };
    }
}

export function initInstrumentation(options: {
    serviceName: string;
    url?: string;
    localDebugging?: boolean;
    concurrencyLimit?: number;
    instrumentations?: any[];
}) {
    diag.info('Initializing OpenTelemetry instrumentation');
    if (options.instrumentations && options.instrumentations.length > 0) {
        diag.info('Using instrumentations:');
        options.instrumentations.forEach((instrumentation) => {
            if (instrumentation && instrumentation.constructor && instrumentation.constructor.name) {
                diag.info(`- ${instrumentation.constructor.name}`);
            } else {
                diag.warn('An instrumentation was provided without a valid constructor name.');
            }
        });
    } else {
        diag.info('No instrumentations specified, using none.');
    }
    contextManager = new AsyncHooksContextManager().enable();
    ({ traceExporter, spanProcessors } = buildExporterOptions({
        url: options.url,
        localDebugging: options.localDebugging,
        concurrencyLimit: options.concurrencyLimit
    }));
    traceExporter = traceExporter;
    spanProcessors = spanProcessors;
    sdk = new NodeSDK({
        contextManager: contextManager,
        serviceName: options.serviceName,
        traceExporter,
        spanProcessors,
        instrumentations: options.instrumentations || []
    });

    sdk.start();
    diag.info('Tracing initialized');
    return {
        sdk,
        traceExporter,
        spanProcessors
    };
}

export async function shutDownInstrumentation() {
    try {
        diag.info('Shutting down OpenTelemetry instrumentation');
        if (!sdk) {
            diag.warn('No OpenTelemetry SDK instance found. Nothing to shut down.');
            return;
        }
        if (!traceExporter) {
            diag.warn('No trace exporter found. Nothing to shut down.');
            return;
        }
        if (typeof traceExporter.forceFlush === 'function') {
            await traceExporter.forceFlush().catch((err) => {
                diag.warn('OTLP forceFlush failed. Ignoring and continuing shutdown.', err);
            });
        }

        await traceExporter.shutdown().catch((err) => {
            diag.warn('OTLP shutdown failed. Ignoring and continuing shutdown.', err);
        });

        await sdk.shutdown().catch((err) => {
            diag.warn('OpenTelemetry SDK shutdown failed. Ignoring and continuing shutdown.', err);
        });

        diag.info('Instrumentation shut down successfully.');
    } catch (error) {
        diag.error('Unexpected error in shutDownInstrumentation (but process will continue):', error);
    }
}
