import { describe, it, expect, beforeEach } from 'vitest';
import { context, trace, SpanStatusCode } from '@opentelemetry/api';
import { exporter } from './setup-otel.ts';

import { Traces } from '../../src/tracing/tracingDecorator.ts';
import { setTracingMode } from '../../src/tracing/tracing-config.ts';

const spans = () => exporter.getFinishedSpans();
const reset = () => exporter.reset();

describe('Traces.getSpan - StartModes', () => {
    beforeEach(reset);

    it('reuse: ohne aktiven Span -> neuer Span', () => {
        const { span, createdSpan } = Traces.getSpan('root-reuse');
        expect(createdSpan).toBe(true);
        span.end();

        const out = spans();
        expect(out).toHaveLength(1);
        expect(out[0].name).toBe('root-reuse');
        expect(out[0].attributes['otel.collector.sampling.keep']).toBe(false);
    });

    it('reuse: mit aktivem Span -> re-use, kein neuer', () => {
        const tracer = trace.getTracer('test');
        const parent = tracer.startSpan('parent', { root: true });

        const res = context.with(trace.setSpan(context.active(), parent), () => {
            return Traces.getSpan('ignored', {}, 'reuse', 'test');
        });

        expect(res.createdSpan).toBe(false);
        expect(res.span).toBe(parent);

        parent.end();
        const out = spans();
        expect(out).toHaveLength(1);
        expect(out[0].name).toBe('parent');
    });

    it('createChild: Parent aktiv -> gleicher traceId & parentSpanId gesetzt', () => {
        const tracer = trace.getTracer('test');
        const parent = tracer.startSpan('p', { root: true });

        context.with(trace.setSpan(context.active(), parent), () => {
            const { span } = Traces.getSpan('child', {}, 'createChild');
            span.end();
        });
        parent.end();

        const out = spans();
        const p = out.find((s: any) => s.name === 'p')!;
        const c = out.find((s: any) => s.name === 'child')!;
        expect(c.spanContext().traceId).toBe(p.spanContext().traceId);
        expect(c.parentSpanContext!.spanId).toBe(p.spanContext().spanId);
    });

    it('newTrace: neuer Root (andere traceId, kein parentSpanId)', () => {
        const tracer = trace.getTracer('test');
        const parent = tracer.startSpan('p', { root: true });

        context.with(trace.setSpan(context.active(), parent), () => {
            const { span } = Traces.getSpan('independent', {}, 'newTrace');
            span.end();
        });
        parent.end();

        const out = spans();
        const p = out.find((s: any) => s.name === 'p')!;
        const n = out.find((s: any) => s.name === 'independent')!;
        expect(n.spanContext().traceId).not.toBe(p.spanContext().traceId);
        expect(n.parentSpanContext).toBeUndefined();
    });

    it('newTraceWithLink: neuer Root (wir prüfen neue traceId; Links optional)', () => {
        const tracer = trace.getTracer('test');
        const parent = tracer.startSpan('p', { root: true });

        context.with(trace.setSpan(context.active(), parent), () => {
            const { span } = Traces.getSpan('linked', {}, 'newTraceWithLink');
            span.end();
        });
        parent.end();

        const out = spans();
        const p = out.find((s: any) => s.name === 'p')!;
        const l = out.find((s: any) => s.name === 'linked')!;
        expect(l.spanContext().traceId).not.toBe(p.spanContext().traceId);
        expect(l.parentSpanContext).toBeUndefined();

        expect(l.links?.[0]?.context.traceId).toBe(p.spanContext().traceId);
        expect(l.links?.[0]?.context.spanId).toBe(p.spanContext().spanId);
    });
});

describe('withTracing - Status/Exceptions/Attribute', () => {
    beforeEach(reset);

    it('OK-Status + Attribute-Merge + function.name', async () => {
        function add(a: number, b: number) {
            return a + b;
        }
        const wrapped = Traces.withTracing(add, {
            spanName: 'sum',
            attributes: { static: 1 },
            dynamicAttributes: (args) => ({ a: args[0], b: args[1] }),
            startMode: 'createChild',
            moduleName: 'calc'
        });

        const tracer = trace.getTracer('test');
        const root = tracer.startSpan('root', { root: true });
        const result = await context.with(trace.setSpan(context.active(), root), () => wrapped(2, 3));
        root.end();

        expect(result).toBe(5);
        const out = spans();
        const s = out.find((s: any) => s.name === 'sum')!;
        expect(s.status.code).toBe(SpanStatusCode.OK);
        expect(s.attributes.static).toBe(1);
        expect(s.attributes.a).toBe(2);
        expect(s.attributes.b).toBe(3);
        expect(s.attributes['function.name']).toBe('add');
    });

    it('Exception -> Status ERROR + exception-Event', async () => {
        function boom() {
            throw new Error('kaputt');
        }
        const wrapped = Traces.withTracing(boom, { spanName: 'boom', startMode: 'createChild' });

        const tracer = trace.getTracer('test');
        const root = tracer.startSpan('root', { root: true });

        await expect(async () => {
            await context.with(trace.setSpan(context.active(), root), () => Promise.resolve().then(() => wrapped()));
        }).rejects.toThrow('kaputt');

        root.end();

        const out = spans();
        const b = out.find((s: any) => s.name === 'boom')!;
        expect(b.status.code).toBe(SpanStatusCode.ERROR);
        expect(b.events.some((e: any) => e.name === 'exception')).toBe(true);
    });

    it('traceOnlyIf=false -> erzeugt keinen Span', () => {
        const fn = (x: number) => x * 2;
        const wrapped = Traces.withTracing(fn, { traceOnlyIf: false, spanName: 'nope' });
        const res = wrapped(7);
        expect(res).toBe(14);
        expect(spans()).toHaveLength(0);
    });

    it('legacy-always-promise -> sync Ergebnis wird zu Promise', async () => {
        setTracingMode('legacy-always-promise');
        const fn = (x: number) => x + 1;
        const wrapped = Traces.withTracing(fn, { spanName: 'legacy' });
        const val = await wrapped(5);
        expect(val).toBe(6);
    });
});

describe('Sampling-Attribut (_setSamplingRule)', () => {
    beforeEach(reset);

    it('setzt otel.collector.sampling.keep=false, falls nicht gesetzt', () => {
        const { span } = Traces.getSpan('sample-default');
        span.end();
        const out = spans();
        expect(out[0].attributes['otel.collector.sampling.keep']).toBe(false);
    });

    it('übernimmt true, wenn explizit gesetzt', () => {
        const { span } = Traces.getSpan('sample-true', {
            attributes: { 'otel.collector.sampling.keep': true }
        });
        span.end();
        const out = spans();
        expect(out[0].attributes['otel.collector.sampling.keep']).toBe(true);
    });
});
