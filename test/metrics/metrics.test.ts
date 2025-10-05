import { describe, it, expect, beforeEach } from 'vitest';
import { register, Counter, Gauge, Histogram, Summary, collectDefaultMetrics } from 'prom-client';

import { Metrics } from '../../src/metrics/metricsDecorator.ts';
import { metrics, createMetric, MetricType } from '../../src/metrics/metrics.ts';
import * as PromClient from 'prom-client';

beforeEach(() => {
    register.clear();
    Metrics.clear();
});

describe('Counter registration / lazy creation / increment', () => {
    it('creates lazily and increments with label conversion', async () => {
        Metrics.registerCounter({
            name: 'test_counter_total',
            help: 'test counter',
            labelNames: ['a', 'b', 'flag']
        });

        expect(register.getSingleMetric('test_counter_total')).toBeUndefined();

        Metrics.incrementCounter('test_counter_total', { a: 'X', b: 2, flag: true, ignore: undefined }, 3);

        const metric = register.getSingleMetric('test_counter_total') as Counter<string>;
        expect(metric).toBeInstanceOf(Counter);

        const json = await register.getMetricsAsJSON();
        const m = json.find((j) => j.name === 'test_counter_total')!;
        expect(m.type).toBe('counter');

        const sample = m.values.find((v: any) => v.labels.a === 'X' && v.labels.b === 2 && v.labels.flag === 'true');
        expect(sample?.value).toBe(3);
    });

    it('throws if incrementing an unknown counter', () => {
        expect(() => Metrics.incrementCounter('does_not_exist')).toThrow(/Counter with name does_not_exist not found/);
    });
});

describe('@Metrics.counter decorator', () => {
    it('increments with error="none" on success and error="<name>" on throw (sync)', async () => {
        class S {
            @Metrics.counter({
                metricName: 'dec_sync_total',
                help: 'dec sync',
                labels: { static: '1' },
                dynamicLabels: (args) => ({ arg0: String(args[0]) })
            })
            run(x: number) {
                if (x < 0) throw new RangeError('neg');
                return x + 1;
            }
        }
        const s = new S();

        expect(s.run(1)).toBe(2);
        try {
            s.run(-1);
        } catch {}

        const json = await register.getMetricsAsJSON();
        const m = json.find((j) => j.name === 'dec_sync_total')!;
        const ok = m.values.find(
            (v: any) => v.labels.error === 'none' && v.labels.static === '1' && v.labels.arg0 === '1'
        );
        const err = m.values.find((v: any) => v.labels.error === 'RangeError' && v.labels.arg0 === '-1');
        expect(ok?.value).toBe(1);
        expect(err?.value).toBe(1);
    });

    it('works with async function and sets error label on rejection', async () => {
        class S {
            @Metrics.counter({
                metricName: 'dec_async_total',
                help: 'dec async',
                dynamicLabels: (args) => ({ id: String(args[0]) })
            })
            async run(id: number) {
                if (id === 42) throw new Error('boom');
                return 'ok';
            }
        }
        const s = new S();

        await s.run(1).then((v) => expect(v).toBe('ok'));
        await expect(s.run(42)).rejects.toThrow('boom');

        const json = await register.getMetricsAsJSON();
        const m = json.find((j) => j.name === 'dec_async_total')!;
        const ok = m.values.find((v: any) => v.labels.error === 'none' && v.labels.id === '1');
        const err = m.values.find((v: any) => v.labels.error === 'Error' && v.labels.id === '42');
        expect(ok?.value).toBe(1);
        expect(err?.value).toBe(1);
    });
});

describe('Gauge registration / set / startTimer', () => {
    it('sets value with boolean label conversion', async () => {
        Metrics.registerGauge({
            name: 'test_gauge',
            help: 'g',
            labelNames: ['flag', 'x']
        });

        Metrics.setGauge('test_gauge', 7, { flag: false, x: 3 });

        const json = await register.getMetricsAsJSON();
        const m = json.find((j) => j.name === 'test_gauge')!;
        const s = m.values.find((v: any) => v.labels.flag === 'false' && v.labels.x === 3);
        expect(s?.value).toBe(7);
    });

    it('startGaugeTimer returns end function and records duration in seconds', async () => {
        Metrics.registerGauge({ name: 'timed_gauge', help: 'tg' });

        const end = Metrics.startGaugeTimer('timed_gauge');
        await new Promise((r) => setTimeout(r, 10));
        end();

        const json = await register.getMetricsAsJSON();
        const m = json.find((j) => j.name === 'timed_gauge')!;
        const s = m.values[0];
        expect(typeof s.value).toBe('number');
        expect(s.value).toBeGreaterThan(0);
    });
});

describe('@Metrics.gauge decorator', () => {
    it('timed=false: sets gauge from numeric return', async () => {
        class S {
            @Metrics.gauge({ metricName: 'dec_gauge', help: 'dg', labels: { stat: '1' } }, false)
            compute(n: number) {
                return n * 2;
            }
        }
        const s = new S();
        expect(s.compute(5)).toBe(10);

        const json = await register.getMetricsAsJSON();
        const m = json.find((j) => j.name === 'dec_gauge')!;
        const s1 = m.values.find((v: any) => v.labels.stat === '1');
        expect(s1?.value).toBe(10);
    });

    it('timed=true: records duration, does not overwrite with return value', async () => {
        class S {
            @Metrics.gauge({ metricName: 'dec_gauge_time', help: 'dgt' }, true)
            async work() {
                await new Promise((r) => setTimeout(r, 5));
                return 123;
            }
        }
        const s = new S();
        await s.work();

        const json = await register.getMetricsAsJSON();
        const m = json.find((j) => j.name === 'dec_gauge_time')!;
        const s1 = m.values[0];
        expect(s1.value).toBeGreaterThan(0);
        expect(s1.value).toBeLessThan(1);
    });
});

describe('Histogram registration / observe', () => {
    it('uses default buckets if none specified and observe() records', async () => {
        Metrics.registerHistogram({ name: 'h1', help: 'h' });
        Metrics.observeHistogram('h1', 0.2, { a: 'b' });

        const json = await register.getMetricsAsJSON();
        const m = json.find((j) => j.name === 'h1')!;
        const count = m.values.find((v: any) => v.metricName?.endsWith('_count'));
        const sum = m.values.find((v: any) => v.metricName?.endsWith('_sum'));
        expect(count?.value).toBeGreaterThan(0);
        expect(sum?.value).toBeGreaterThan(0);
    });
});

describe('@Metrics.histogram decorator', () => {
    it('times the method and sets error label on throw', async () => {
        class S {
            @Metrics.histogram({
                metricName: 'dec_hist',
                help: 'd-h',
                labels: { svc: 'x' },
                dynamicLabels: (a) => ({ arg0: String(a[0]) }),
                buckets: [0.001, 0.01, 0.1, 1]
            })
            async run(x: number) {
                if (x < 0) throw new Error('bad');
                await new Promise((r) => setTimeout(r, 5));
                return 'ok';
            }
        }
        const s = new S();
        await s.run(1);
        await expect(s.run(-1)).rejects.toThrow('bad');

        const json = await register.getMetricsAsJSON();
        const m = json.find((j) => j.name === 'dec_hist')!;

        const counts = m.values.filter((v: any) => v.metricName?.endsWith('_count'));
        const total = counts.reduce((acc: number, s: any) => acc + (s.value || 0), 0);
        expect(total).toBeGreaterThanOrEqual(2);
    });
});

describe('Summary registration / observe', () => {
    it('observes values and exposes quantiles', async () => {
        Metrics.registerSummary({ name: 'sum1', help: 's' });
        Metrics.observeSummary('sum1', 1.0);
        Metrics.observeSummary('sum1', 2.0);

        const json = await register.getMetricsAsJSON();
        const m = json.find((j) => j.name === 'sum1')!;
        const count = m.values.find((v: any) => v.metricName?.endsWith('_count'));
        const sum = m.values.find((v: any) => v.metricName?.endsWith('_sum'));
        expect(count?.value).toBeGreaterThanOrEqual(2);
        expect(sum?.value).toBeGreaterThan(0);
    });
});

describe('@Metrics.summary decorator', () => {
    it('timed=false: observes numeric return value', async () => {
        class S {
            @Metrics.summary({ metricName: 'dec_sum', help: 'ds' }, false)
            calc() {
                return 7;
            }
        }
        const s = new S();
        expect(s.calc()).toBe(7);

        const json = await register.getMetricsAsJSON();
        const m = json.find((j) => j.name === 'dec_sum')!;
        const count = m.values.find((v: any) => v.metricName?.endsWith('_count'));
        const sum = m.values.find((v: any) => v.metricName?.endsWith('_sum'));
        expect(count?.value).toBeGreaterThanOrEqual(1);
        expect(sum?.value).toBeGreaterThanOrEqual(7);
    });

    it('timed=true: records duration via startTimer', async () => {
        class S {
            @Metrics.summary({ metricName: 'dec_sum_time', help: 'dst' }, true)
            async slow() {
                await new Promise((r) => setTimeout(r, 5));
                return 123;
            }
        }
        const s = new S();
        await s.slow();

        const json = await register.getMetricsAsJSON();
        const m = json.find((j) => j.name === 'dec_sum_time')!;
        const count = m.values.find((v: any) => v.metricName?.endsWith('_count'));
        expect(count?.value).toBeGreaterThanOrEqual(1);
    });
});

describe('metrics facade (getMetrics/createMetric/…)', () => {
    it('getMetrics returns contentType and exposition string', async () => {
        collectDefaultMetrics();
        const out = await metrics.getMetrics();
        expect(out.contentType).toBe(register.contentType);
        expect(typeof out.data).toBe('string');
        expect(out.data.length).toBeGreaterThan(0);
    });

    it('createMetric registers via type switch', () => {
        createMetric(MetricType.Counter, { name: 'sw_cnt', help: 'x' });
        createMetric(MetricType.Gauge, { name: 'sw_g', help: 'x' });
        createMetric(MetricType.Histogram, { name: 'sw_h', help: 'x', buckets: [0.1, 1] });
        createMetric(MetricType.Summary, { name: 'sw_s', help: 'x', percentiles: [0.5, 0.9] });

        Metrics.incrementCounter('sw_cnt', {}, 1);
        Metrics.setGauge('sw_g', 1);
        Metrics.observeHistogram('sw_h', 0.5);
        Metrics.observeSummary('sw_s', 1.5);

        expect(register.getSingleMetric('sw_cnt')).toBeInstanceOf(Counter);
        expect(register.getSingleMetric('sw_g')).toBeInstanceOf(Gauge);
        expect(register.getSingleMetric('sw_h')).toBeInstanceOf(Histogram);
        expect(register.getSingleMetric('sw_s')).toBeInstanceOf(Summary);
    });

    it('facade methods delegate to Metrics helpers (counter/gauge/histogram/summary)', async () => {
        createMetric(MetricType.Counter, { name: 'fac_cnt', help: 'x', labelNames: ['a', 'flag'] });
        metrics.incrementCounter('fac_cnt', { a: '1', flag: true }, 2);

        createMetric(MetricType.Gauge, { name: 'fac_g', help: 'x' });
        metrics.setGauge('fac_g', 11);

        createMetric(MetricType.Histogram, { name: 'fac_h', help: 'x', buckets: [0.001, 0.01] });
        metrics.observeHistogram('fac_h', 0.005);

        createMetric(MetricType.Summary, { name: 'fac_s', help: 'x' });
        metrics.observeSummary('fac_s', 3.14);

        const json = await register.getMetricsAsJSON();
        expect(json.some((j) => j.name === 'fac_cnt')).toBe(true);
        expect(json.some((j) => j.name === 'fac_g')).toBe(true);
        expect(json.some((j) => j.name === 'fac_h')).toBe(true);
        expect(json.some((j) => j.name === 'fac_s')).toBe(true);
    });
});
describe('TC39-style decorators (factory(value, ctx))', () => {
    it('counter (method): increments and sets error label', async () => {
        const dec = Metrics.counter({
            metricName: 'tc39_counter_total',
            help: 'tc39 counter',
            labels: { static: '1' },
            dynamicLabels: (args) => ({ arg0: String(args[0]) })
        });

        const original = function (x: number) {
            if (x < 0) throw new RangeError('neg');
            return x + 1;
        };
        const wrapped = dec(original, { kind: 'method', name: 'run' });

        expect(wrapped(1)).toBe(2);
        try {
            wrapped(-1);
        } catch {}

        const json = await register.getMetricsAsJSON();
        const m = json.find((j) => j.name === 'tc39_counter_total')!;
        const ok = m.values.find(
            (v: any) => v.labels.error === 'none' && v.labels.static === '1' && v.labels.arg0 === '1'
        );
        const err = m.values.find((v: any) => v.labels.error === 'RangeError' && v.labels.arg0 === '-1');
        expect(ok?.value).toBe(1);
        expect(err?.value).toBe(1);
    });

    it('gauge (method, timed=false): sets gauge from numeric return', async () => {
        const dec = Metrics.gauge({ metricName: 'tc39_gauge', help: 'tc39 g' }, false);

        const original = function (n: number) {
            return n * 3;
        };
        const wrapped = dec(original, { kind: 'method', name: 'compute' });

        expect(wrapped(4)).toBe(12);

        const json = await register.getMetricsAsJSON();
        const m = json.find((j) => j.name === 'tc39_gauge')!;
        const s = m.values[0];
        expect(s.value).toBe(12);
    });

    it('gauge (method, timed=true): records duration only', async () => {
        const dec = Metrics.gauge({ metricName: 'tc39_gauge_time', help: 'tc39 g time' }, true);

        const original = async function () {
            await new Promise((r) => setTimeout(r, 5));
            return 777;
        };
        const wrapped = dec(original, { kind: 'method', name: 'work' });

        await wrapped();

        const json = await register.getMetricsAsJSON();
        const m = json.find((j) => j.name === 'tc39_gauge_time')!;
        const s = m.values[0];
        expect(s.value).toBeGreaterThan(0);
        expect(s.value).toBeLessThan(1);
    });

    it('histogram (field): times and sets error label across series', async () => {
        const dec = Metrics.histogram({
            metricName: 'tc39_hist',
            help: 'tc39 h',
            labels: { svc: 'x' },
            dynamicLabels: (a) => ({ arg0: String(a[0]) }),
            buckets: [0.001, 0.01, 0.1, 1]
        });

        const init = dec(function noop() {}, { kind: 'field', name: 'run' });
        const run = init(function (x: number) {
            if (x < 0) throw new Error('bad');
            return 'ok';
        });

        await Promise.resolve()
            .then(() => new Promise((r) => setTimeout(r, 5)))
            .then(() => run(1));
        await expect((async () => run(-1))()).rejects.toThrow('bad');

        const json = await register.getMetricsAsJSON();
        const m = json.find((j) => j.name === 'tc39_hist')!;

        const counts = m.values.filter((v: any) => v.metricName?.endsWith('_count'));
        const total = counts.reduce((acc: number, s: any) => acc + (s.value || 0), 0);
        expect(total).toBeGreaterThanOrEqual(2);
    });

    it('summary (auto-accessor, timed=false): observes numeric return value', async () => {
        const dec = Metrics.summary({ metricName: 'tc39_sum', help: 'tc39 s' }, false);

        const acc = dec(function noop() {}, { kind: 'auto-accessor', name: 'calc' });
        const calc = acc.init(function () {
            return 13;
        });

        expect(calc()).toBe(13);

        const json = await register.getMetricsAsJSON();
        const m = json.find((j) => j.name === 'tc39_sum')!;
        const count = m.values.find((v: any) => v.metricName?.endsWith('_count'));
        const sum = m.values.find((v: any) => v.metricName?.endsWith('_sum'));
        expect(count?.value).toBeGreaterThanOrEqual(1);
        expect(sum?.value).toBeGreaterThanOrEqual(13);
    });

    it('summary (method, timed=true): records duration via startTimer', async () => {
        const dec = Metrics.summary({ metricName: 'tc39_sum_time', help: 'tc39 s time' }, true);

        const original = async function () {
            await new Promise((r) => setTimeout(r, 5));
            return 12345;
        };
        const wrapped = dec(original, { kind: 'method', name: 'slow' });

        await wrapped();

        const json = await register.getMetricsAsJSON();
        const m = json.find((j) => j.name === 'tc39_sum_time')!;
        const count = m.values.find((v: any) => v.metricName?.endsWith('_count'));
        expect(count?.value).toBeGreaterThanOrEqual(1);
    });
});
import { vi } from 'vitest';
describe('http metrics middleware (e2e)', () => {
    it('records duration, count and sum with route pattern labels', async () => {
        await vi.resetModules();
        Metrics.clear();
        const express = (await import('express')).default;
        const request = (await import('supertest')).default;
        const { httpMetricsMiddleWare } = await import('../../src/metrics/httpMetrics.ts');

        const app = express();
        app.use(httpMetricsMiddleWare);

        app.get('/users/:id', (_req: any, res: any) => res.status(200).send('ok'));
        app.get('/health', (_req: any, res: any) => res.status(204).end());

        await request(app).get('/users/123');
        await request(app).get('/health');

        const json = await register.getMetricsAsJSON();

        const hJson = json.find((j) => j.name === 'http_request_duration_seconds')!;
        const hCounts = hJson.values.filter((v: any) => v.metricName?.endsWith('_count'));
        const hTotalCount = hCounts.reduce((acc: number, v: any) => acc + (v.value || 0), 0);
        expect(hTotalCount).toBeGreaterThanOrEqual(2);

        const cJson = json.find((j) => j.name === 'http_requests_total')!;
        const usersRouteSample = cJson.values.find((v: any) => v.labels.route === '/users/:id');
        const healthRouteSample = cJson.values.find((v: any) => v.labels.route === '/health');
        expect(usersRouteSample?.value).toBeGreaterThanOrEqual(1);
        expect(healthRouteSample?.value).toBeGreaterThanOrEqual(1);

        const sJson = json.find((j) => j.name === 'http_request_duration_sum')!;
        const sumAny = sJson.values[0];
        expect(sumAny.value).toBeGreaterThan(0);
    });
});
