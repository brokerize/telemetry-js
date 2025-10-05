import { describe, it, expect, beforeEach } from 'vitest';
import { context, trace, SpanStatusCode } from '@opentelemetry/api';
import { exporter } from './setup-otel.ts';

import { Traces } from '../../src/tracing/tracingDecorator.ts';

const spans = () => exporter.getFinishedSpans();
const reset = () => exporter.reset();

describe('Decorator - new TC39-Form', () => {
    beforeEach(reset);

    it('wrapped method creates Span with Name/Attributes', async () => {
        class Svc {
            // @ts-ignore: Decorator-Aufruf in TS 5.x inline
            @Traces.trace({
                spanName: 'svc.process',
                attributes: { svc: 'demo' },
                dynamicAttributes: (args) => ({ x: args[0] }),
                startMode: 'createChild',
                moduleName: 'svc'
            })
            async process(x: number) {
                return x * 3;
            }
        }
        const svc = new Svc();

        const tracer = trace.getTracer('test');
        const root = tracer.startSpan('root', { root: true });
        const res = await context.with(trace.setSpan(context.active(), root), () => svc.process(4));
        root.end();

        expect(res).toBe(12);
        const out = spans();
        const s = out.find((s: any) => s.name === 'svc.process')!;
        expect(s.status.code).toBe(SpanStatusCode.OK);
        expect(s.attributes.svc).toBe('demo');
        expect(s.attributes.x).toBe(4);
        expect(s.attributes['function.name']).toBe('process');
    });
});

describe('Decorator - Legacy-Form (target, key, descriptor)', () => {
    beforeEach(reset);

    it('wrapped legacy method works', async () => {
        class Svc {
            process(x: number) {
                return x + 10;
            }
        }

        const desc = Object.getOwnPropertyDescriptor(Svc.prototype, 'process')!;
        const newDesc = (
            Traces.trace({
                spanName: 'svc.legacy',
                startMode: 'createChild',
                moduleName: 'svc'
            }) as any
        )(Svc.prototype, 'process', desc);
        Object.defineProperty(Svc.prototype, 'process', newDesc);

        const svc = new Svc();
        const tracer = trace.getTracer('test');
        const root = tracer.startSpan('root', { root: true });
        const res = await context.with(trace.setSpan(context.active(), root), () => svc.process(5));
        root.end();

        expect(res).toBe(15);
        const out = spans();
        const s = out.find((s: any) => s.name === 'svc.legacy')!;
        expect(s.status.code).toBe(SpanStatusCode.OK);
        expect(s.attributes['function.name']).toBe('process');
    });
});
