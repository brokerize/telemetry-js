import { describe, it, expect } from 'vitest';
import { initInstrumentation, shutDownInstrumentation } from '../../src/instrumentation.ts';
import { BatchSpanProcessor, ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

describe('NodeSDK init/shutdown (integration, ohne Netz)', () => {
    it('init mit Default -> no-op Exporter (kein Throw) & shutdown ohne Fehler', async () => {
        const { sdk, traceExporter, spanProcessors } = initInstrumentation({
            serviceName: 'svc-default',
            instrumentations: []
        });

        expect(sdk).toBeTruthy();
        expect(traceExporter).toBeTruthy();
        expect(spanProcessors === undefined || Array.isArray(spanProcessors)).toBe(true);

        await shutDownInstrumentation();
    });

    it('init mit localDebugging=true -> ConsoleSpanExporter', async () => {
        const { traceExporter } = initInstrumentation({
            serviceName: 'svc-console',
            localDebugging: true,
            instrumentations: []
        });

        expect(traceExporter).toBeInstanceOf(ConsoleSpanExporter);
        await shutDownInstrumentation();
    });

    it('init mit OTLP URL -> OTLPTraceExporter konstruiert', async () => {
        const { traceExporter } = initInstrumentation({
            serviceName: 'svc-otlp',
            url: 'http://localhost:4318/v1/traces',
            instrumentations: [],
            concurrencyLimit: 5
        });

        expect(traceExporter).toBeInstanceOf(OTLPTraceExporter);
        await shutDownInstrumentation();
    });

    it('spanLimits: werden am Provider wirksam (Count-/Length-Limits, Events, Links)', async () => {
        initInstrumentation({
            serviceName: 'svc-limits',
            instrumentations: [],
            spanLimits: {
                attributeCountLimit: 2,
                attributeValueLengthLimit: 4,
                eventCountLimit: 1,
                linkCountLimit: 1,
                attributePerEventCountLimit: 1,
                attributePerLinkCountLimit: 1
            }
        });

        const { trace } = await import('@opentelemetry/api');
        const tracer = trace.getTracer('limits-test');

        const pA = tracer.startSpan('parentA', { root: true });
        const pB = tracer.startSpan('parentB', { root: true });
        const pC = tracer.startSpan('parentC', { root: true });

        const span: any = tracer.startSpan('limited', {
            links: [
                { context: pA.spanContext(), attributes: { a: 1, b: 2 } },
                { context: pB.spanContext(), attributes: { c: 3, d: 4 } },
                { context: pC.spanContext() }
            ],
            root: true
        });

        span.setAttribute('k1', '1234567');
        span.setAttribute('k2', 'X');
        span.setAttribute('k3', 'Y');

        span.addEvent('e2');
        span.addEvent('e1', { a: 1, b: 2 });

        expect(span._spanLimits.attributeCountLimit).toBe(2);
        expect(span._spanLimits.attributeValueLengthLimit).toBe(4);
        expect(span._spanLimits.eventCountLimit).toBe(1);
        expect(span._spanLimits.linkCountLimit).toBe(1);

        const attr = span.attributes ?? {};
        expect(Object.keys(attr)).toHaveLength(2);
        expect(attr['k1']).toBe('1234');
        expect(span._droppedAttributesCount).toBeGreaterThanOrEqual(1);

        const evts = span.events ?? [];
        expect(evts).toHaveLength(1);
        expect(evts[0].name).toBe('e1');

        const lnks = span.links ?? [];
        expect(Array.isArray(lnks)).toBe(true);
        expect(lnks.length).toBeGreaterThan(0);
        expect(span._droppedLinksCount).toBeGreaterThanOrEqual(0);

        span.end();
        pA.end();
        pB.end();
        pC.end();
        await shutDownInstrumentation();
    });

    describe('NodeSDK init/shutdown – Exporter/Processor precedence (integration, offline)', () => {
        it('exporter descriptor: console -> ConsoleSpanExporter + default BatchSpanProcessor', async () => {
            const { traceExporter, spanProcessors } = initInstrumentation({
                serviceName: 'svc-exporter-console',
                instrumentations: [],
                exporter: { kind: 'console' }
            });

            expect(traceExporter).toBeInstanceOf(ConsoleSpanExporter);
            // Library should attach a default BatchSpanProcessor when exporter is provided
            expect(Array.isArray(spanProcessors)).toBe(true);
            expect(spanProcessors!.some((p) => p instanceof BatchSpanProcessor)).toBe(true);

            await shutDownInstrumentation();
        });

        it('exporter descriptor: otlp -> OTLPTraceExporter + default BatchSpanProcessor (no network I/O expected)', async () => {
            const { traceExporter, spanProcessors } = initInstrumentation({
                serviceName: 'svc-exporter-otlp',
                instrumentations: [],
                exporter: { kind: 'otlp', url: 'http://localhost:4318/v1/traces', concurrencyLimit: 3 }
            });

            expect(traceExporter).toBeInstanceOf(OTLPTraceExporter);
            expect(Array.isArray(spanProcessors)).toBe(true);
            expect(spanProcessors!.some((p) => p instanceof BatchSpanProcessor)).toBe(true);

            await shutDownInstrumentation();
        });

        it('exporter descriptor: otlp -> OTLPTraceExporter + Headers + default BatchSpanProcessor (no network I/O expected)', async () => {
            const { traceExporter, spanProcessors } = initInstrumentation({
                serviceName: 'svc-exporter-otlp',
                instrumentations: [],
                exporter: {
                    kind: 'otlp',
                    url: 'http://localhost:4318/v1/traces',
                    concurrencyLimit: 3,
                    headers: { 'x-api-key': 'secret' }
                }
            });

            expect(traceExporter).toBeInstanceOf(OTLPTraceExporter);
            expect(Array.isArray(spanProcessors)).toBe(true);
            expect(spanProcessors!.some((p) => p instanceof BatchSpanProcessor)).toBe(true);

            await shutDownInstrumentation();
        });

        it('exporter descriptor: noop -> noop exporter; no processors attached', async () => {
            const { traceExporter, spanProcessors } = initInstrumentation({
                serviceName: 'svc-exporter-noop',
                instrumentations: [],
                exporter: { kind: 'noop' }
            });

            expect(traceExporter).not.toBeInstanceOf(ConsoleSpanExporter);
            expect(traceExporter).not.toBeInstanceOf(OTLPTraceExporter);

            expect(spanProcessors === undefined || (Array.isArray(spanProcessors) && spanProcessors.length === 0)).toBe(
                true
            );

            await shutDownInstrumentation();
        });

        it('concrete SpanExporter instance + no spanProcessors -> library creates default BatchSpanProcessor', async () => {
            const exporter = new ConsoleSpanExporter();
            const { traceExporter, spanProcessors } = initInstrumentation({
                serviceName: 'svc-exporter-instance',
                instrumentations: [],
                exporter
            });

            expect(traceExporter).toBe(exporter);
            expect(Array.isArray(spanProcessors)).toBe(true);
            expect(spanProcessors!.length).toBeGreaterThanOrEqual(1);
            expect(spanProcessors!.some((p) => p instanceof BatchSpanProcessor)).toBe(true);

            await shutDownInstrumentation();
        });

        it('explicit spanProcessors -> processors used as-is (no implicit defaults added)', async () => {
            const custom = new BatchSpanProcessor(new ConsoleSpanExporter());
            const { spanProcessors, traceExporter } = initInstrumentation({
                serviceName: 'svc-explicit-processors',
                instrumentations: [],
                spanProcessors: [custom]
                // exporter intentionally omitted
            });

            expect(Array.isArray(spanProcessors)).toBe(true);
            expect(spanProcessors!.length).toBe(1);
            expect(spanProcessors![0]).toBe(custom);
            expect(spanProcessors!.filter((p) => p instanceof BatchSpanProcessor).length).toBe(1);

            await shutDownInstrumentation();
        });

        it('legacy flags (url/localDebugging) still work but are deprecated: url -> OTLP, localDebugging -> Console', async () => {
            {
                const { traceExporter, spanProcessors } = initInstrumentation({
                    serviceName: 'svc-legacy-console',
                    instrumentations: [],
                    localDebugging: true
                });
                expect(traceExporter).toBeInstanceOf(ConsoleSpanExporter);
                expect(Array.isArray(spanProcessors)).toBe(true);
                expect(spanProcessors!.some((p) => p instanceof BatchSpanProcessor)).toBe(true);
                await shutDownInstrumentation();
            }

            {
                const { traceExporter, spanProcessors } = initInstrumentation({
                    serviceName: 'svc-legacy-otlp',
                    instrumentations: [],
                    url: 'http://localhost:4318/v1/traces',
                    concurrencyLimit: 2
                });
                expect(traceExporter).toBeInstanceOf(OTLPTraceExporter);
                expect(Array.isArray(spanProcessors)).toBe(true);
                expect(spanProcessors!.some((p) => p instanceof BatchSpanProcessor)).toBe(true);
                await shutDownInstrumentation();
            }
        });
    });
});
