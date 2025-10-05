import type {
    CounterConfiguration,
    GaugeConfiguration,
    HistogramConfiguration,
    SummaryConfiguration
} from 'prom-client';
// @ts-strict-ignore
import { Counter, Gauge, Histogram, register, Summary } from 'prom-client';

export interface MetricDecoratorOptions {
    metricName: string;
    help: string;
    labels?: Record<string, string>;
    dynamicLabels?: (args: any[]) => Record<string, string | number | boolean>;
}

export interface HistogramDecoratorOptions extends MetricDecoratorOptions {
    buckets?: number[];
}

export interface SummaryDecoratorOptions extends MetricDecoratorOptions {
    percentiles?: number[];
}

export class Metrics {
    private static counterConfigs: Map<string, CounterConfiguration<string>> = new Map();
    private static gaugeConfigs: Map<string, GaugeConfiguration<string>> = new Map();
    private static histogramConfigs: Map<string, HistogramConfiguration<string>> = new Map();
    private static summaryConfigs: Map<string, SummaryConfiguration<string>> = new Map();
    private static counters: Map<string, Counter<any>> = new Map();
    private static gauges: Map<string, Gauge<any>> = new Map();
    private static histograms: Map<string, Histogram<any>> = new Map();
    private static summaries: Map<string, any> = new Map();

    static clear() {
        register.clear();

        this.counters.clear();
        this.gauges.clear();
        this.histograms.clear();
    }

    static registerCounter<T extends string>(counterConfig: CounterConfiguration<T>) {
        if (!counterConfig.labelNames) counterConfig.labelNames = [];
        if (counterConfig.collect) {
            this.counters.set(counterConfig.name, new Counter(counterConfig));
        } else {
            this.counterConfigs.set(counterConfig.name, counterConfig);
        }
    }

    static getCounter(metricName: string): Counter<any> | undefined {
        if (!this.counters.has(metricName)) {
            const config = this.counterConfigs.get(metricName);
            if (config) {
                this.counters.set(metricName, new Counter(config));
            }
        }
        return this.counters.get(metricName);
    }

    static incrementCounter(
        metricName: string,
        labels?: Record<string, string | number | boolean | undefined>,
        incrementValue?: number
    ) {
        const converted = this._convertLabels(labels);
        const counter = this._ensureCounterWithLabels(metricName, converted);
        if (!counter) throw new Error(`Counter with name ${metricName} not found.`);

        const filtered = this._filterAllowed(counter, converted);
        if (Object.keys(filtered).length) counter.inc(filtered as any, incrementValue);
        else counter.inc(incrementValue);
    }

    static counter(options: MetricDecoratorOptions) {
        const factory: any = (...decoratorArgs: any[]) => {
            if (
                decoratorArgs.length === 2 &&
                typeof decoratorArgs[0] === 'function' &&
                decoratorArgs[1] &&
                typeof decoratorArgs[1] === 'object' &&
                'kind' in decoratorArgs[1]
            ) {
                const value: Function = decoratorArgs[0];
                const ctx: { kind: 'method' | 'getter' | 'setter' | 'field' | 'auto-accessor'; name: string | symbol } =
                    decoratorArgs[1];

                if (ctx.kind === 'field') {
                    return function (initialValue: unknown) {
                        if (typeof initialValue !== 'function') return initialValue;
                        return Metrics._wrapWithCounter(initialValue as any, options);
                    };
                }

                if (ctx.kind === 'auto-accessor') {
                    return {
                        init(initialValue: unknown) {
                            if (typeof initialValue !== 'function') return initialValue;
                            return Metrics._wrapWithCounter(initialValue as any, options);
                        }
                    };
                }

                if (ctx.kind === 'method' || ctx.kind === 'getter' || ctx.kind === 'setter') {
                    return Metrics._wrapWithCounter(value as any, options);
                }

                return value;
            }

            if (
                decoratorArgs.length === 3 &&
                typeof decoratorArgs[1] !== 'undefined' &&
                decoratorArgs[2] &&
                typeof decoratorArgs[2] === 'object'
            ) {
                const descriptor: PropertyDescriptor = decoratorArgs[2];
                if (!descriptor) return descriptor;

                const original = descriptor.value ?? descriptor.get ?? descriptor.set;
                if (typeof original !== 'function') return descriptor;

                const wrapped = Metrics._wrapWithCounter(original, options);
                if (descriptor.value) descriptor.value = wrapped;
                else if (descriptor.get) descriptor.get = wrapped;
                else if (descriptor.set) descriptor.set = wrapped;

                return descriptor;
            }

            return decoratorArgs[2];
        };

        return factory;
    }

    static registerGauge<T extends string>(gaugeConfig: GaugeConfiguration<T>) {
        if (!gaugeConfig.labelNames) gaugeConfig.labelNames = [];
        if (gaugeConfig.collect) {
            this.gauges.set(gaugeConfig.name, new Gauge(gaugeConfig));
        } else {
            this.gaugeConfigs.set(gaugeConfig.name, gaugeConfig);
        }
    }

    static getGauge(metricName: string): Gauge<any> | undefined {
        if (!this.gauges.has(metricName)) {
            const config = this.gaugeConfigs.get(metricName);
            if (config) {
                this.gauges.set(metricName, new Gauge(config));
            }
        }
        return this.gauges.get(metricName);
    }

    static setGauge(metricName: string, value: number, labels?: Record<string, string | number | boolean>) {
        const converted = this._convertLabels(labels);
        const gauge = this._ensureGaugeWithLabels(metricName, converted);
        if (!gauge) throw new Error(`Gauge with name ${metricName} not found.`);

        const filtered = this._filterAllowed(gauge, converted);
        if (Object.keys(filtered).length) gauge.set(filtered as any, value);
        else gauge.set(value);
    }

    static startGaugeTimer(metricName: string, labels?: Record<string, string | number | boolean>) {
        const converted = this._convertLabels(labels);
        const gauge = this._ensureGaugeWithLabels(metricName, converted);
        if (!gauge) throw new Error(`Gauge with name ${metricName} not found.`);

        const filtered = this._filterAllowed(gauge, converted);
        return Object.keys(filtered).length ? gauge.startTimer(filtered as any) : gauge.startTimer();
    }

    static gauge(options: MetricDecoratorOptions, timed: boolean = false) {
        const factory: any = (...decoratorArgs: any[]) => {
            if (
                decoratorArgs.length === 2 &&
                typeof decoratorArgs[0] === 'function' &&
                decoratorArgs[1] &&
                typeof decoratorArgs[1] === 'object' &&
                'kind' in decoratorArgs[1]
            ) {
                const value: Function = decoratorArgs[0];
                const ctx: { kind: 'method' | 'getter' | 'setter' | 'field' | 'auto-accessor'; name: string | symbol } =
                    decoratorArgs[1];

                if (ctx.kind === 'field') {
                    return function (initialValue: unknown) {
                        if (typeof initialValue !== 'function') return initialValue;
                        return Metrics._wrapWithGauge(initialValue as any, options, timed);
                    };
                }

                if (ctx.kind === 'auto-accessor') {
                    return {
                        init(initialValue: unknown) {
                            if (typeof initialValue !== 'function') return initialValue;
                            return Metrics._wrapWithGauge(initialValue as any, options, timed);
                        }
                    };
                }

                if (ctx.kind === 'method' || ctx.kind === 'getter' || ctx.kind === 'setter') {
                    return Metrics._wrapWithGauge(value as any, options, timed);
                }

                return value;
            }

            if (
                decoratorArgs.length === 3 &&
                typeof decoratorArgs[1] !== 'undefined' &&
                decoratorArgs[2] &&
                typeof decoratorArgs[2] === 'object'
            ) {
                const descriptor: PropertyDescriptor = decoratorArgs[2];
                if (!descriptor) return descriptor;

                const original = descriptor.value ?? descriptor.get ?? descriptor.set;
                if (typeof original !== 'function') return descriptor;

                const wrapped = Metrics._wrapWithGauge(original, options, timed);
                if (descriptor.value) descriptor.value = wrapped;
                else if (descriptor.get) descriptor.get = wrapped;
                else if (descriptor.set) descriptor.set = wrapped;

                return descriptor;
            }

            return decoratorArgs[2];
        };

        return factory;
    }

    static registerHistogram<T extends string>(histogramConfig: HistogramConfiguration<T>) {
        if (!histogramConfig.labelNames) histogramConfig.labelNames = [];
        if (!histogramConfig.buckets) {
            histogramConfig.buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
        }
        if (histogramConfig.collect) {
            this.histograms.set(histogramConfig.name, new Histogram(histogramConfig));
        } else {
            this.histogramConfigs.set(histogramConfig.name, histogramConfig);
        }
    }

    static getHistogram(metricName: string): Histogram<any> | undefined {
        if (!this.histograms.has(metricName)) {
            const config = this.histogramConfigs.get(metricName);
            if (config) {
                this.histograms.set(metricName, new Histogram(config));
            }
        }
        return this.histograms.get(metricName);
    }

    static observeHistogram(metricName: string, value: number, labels?: Record<string, string | number | boolean>) {
        const converted = this._convertLabels(labels);
        const histogram = this._ensureHistogramWithLabels(metricName, converted);
        if (!histogram) throw new Error(`Histogram with name ${metricName} not found.`);

        const filtered = this._filterAllowed(histogram, converted);
        if (Object.keys(filtered).length) histogram.observe(filtered as any, value);
        else histogram.observe(value);
    }

    static histogram(options: HistogramDecoratorOptions) {
        const factory: any = (...decoratorArgs: any[]) => {
            if (
                decoratorArgs.length === 2 &&
                typeof decoratorArgs[0] === 'function' &&
                decoratorArgs[1] &&
                typeof decoratorArgs[1] === 'object' &&
                'kind' in decoratorArgs[1]
            ) {
                const value: Function = decoratorArgs[0];
                const ctx: { kind: 'method' | 'getter' | 'setter' | 'field' | 'auto-accessor'; name: string | symbol } =
                    decoratorArgs[1];

                if (ctx.kind === 'field') {
                    return function (initialValue: unknown) {
                        if (typeof initialValue !== 'function') return initialValue;
                        return Metrics._wrapWithHistogram(initialValue as any, options);
                    };
                }

                if (ctx.kind === 'auto-accessor') {
                    return {
                        init(initialValue: unknown) {
                            if (typeof initialValue !== 'function') return initialValue;
                            return Metrics._wrapWithHistogram(initialValue as any, options);
                        }
                    };
                }

                if (ctx.kind === 'method' || ctx.kind === 'getter' || ctx.kind === 'setter') {
                    return Metrics._wrapWithHistogram(value as any, options);
                }

                return value;
            }

            if (
                decoratorArgs.length === 3 &&
                typeof decoratorArgs[1] !== 'undefined' &&
                decoratorArgs[2] &&
                typeof decoratorArgs[2] === 'object'
            ) {
                const descriptor: PropertyDescriptor = decoratorArgs[2];
                if (!descriptor) return descriptor;

                const original = descriptor.value ?? descriptor.get ?? descriptor.set;
                if (typeof original !== 'function') return descriptor;

                const wrapped = Metrics._wrapWithHistogram(original, options);
                if (descriptor.value) descriptor.value = wrapped;
                else if (descriptor.get) descriptor.get = wrapped;
                else if (descriptor.set) descriptor.set = wrapped;

                return descriptor;
            }

            return decoratorArgs[2];
        };

        return factory;
    }

    static registerSummary<T extends string>(summaryConfig: SummaryConfiguration<T>) {
        if (!summaryConfig.labelNames) summaryConfig.labelNames = [];
        if (!summaryConfig.percentiles) {
            summaryConfig.percentiles = [0.5, 0.9, 0.95, 0.99];
        }
        if (summaryConfig.collect) {
            this.summaries.set(summaryConfig.name, new Summary(summaryConfig));
        } else {
            this.summaryConfigs.set(summaryConfig.name, summaryConfig);
        }
    }

    static summary(options: SummaryDecoratorOptions, timed: boolean = false) {
        const factory: any = (...decoratorArgs: any[]) => {
            if (
                decoratorArgs.length === 2 &&
                typeof decoratorArgs[0] === 'function' &&
                decoratorArgs[1] &&
                typeof decoratorArgs[1] === 'object' &&
                'kind' in decoratorArgs[1]
            ) {
                const value: Function = decoratorArgs[0];
                const ctx: { kind: 'method' | 'getter' | 'setter' | 'field' | 'auto-accessor'; name: string | symbol } =
                    decoratorArgs[1];

                if (ctx.kind === 'field') {
                    return function (initialValue: unknown) {
                        if (typeof initialValue !== 'function') return initialValue;
                        return Metrics._wrapWithSummary(initialValue as any, options, timed);
                    };
                }

                if (ctx.kind === 'auto-accessor') {
                    return {
                        init(initialValue: unknown) {
                            if (typeof initialValue !== 'function') return initialValue;
                            return Metrics._wrapWithSummary(initialValue as any, options, timed);
                        }
                    };
                }

                if (ctx.kind === 'method' || ctx.kind === 'getter' || ctx.kind === 'setter') {
                    return Metrics._wrapWithSummary(value as any, options, timed);
                }

                return value;
            }

            if (
                decoratorArgs.length === 3 &&
                typeof decoratorArgs[1] !== 'undefined' &&
                decoratorArgs[2] &&
                typeof decoratorArgs[2] === 'object'
            ) {
                const descriptor: PropertyDescriptor = decoratorArgs[2];
                if (!descriptor) return descriptor;

                const original = descriptor.value ?? descriptor.get ?? descriptor.set;
                if (typeof original !== 'function') return descriptor;

                const wrapped = Metrics._wrapWithSummary(original, options, timed);
                if (descriptor.value) descriptor.value = wrapped;
                else if (descriptor.get) descriptor.get = wrapped;
                else if (descriptor.set) descriptor.set = wrapped;

                return descriptor;
            }

            return decoratorArgs[2];
        };

        return factory;
    }

    static getSummary(metricName: string): Summary<any> | undefined {
        if (!this.summaries.has(metricName)) {
            const config = this.summaryConfigs.get(metricName);
            if (config) {
                this.summaries.set(metricName, new Summary(config));
            }
        }

        return this.summaries.get(metricName);
    }

    static observeSummary(metricName: string, value: number, labels?: Record<string, string | number | boolean>) {
        const converted = this._convertLabels(labels);
        const summary = this._ensureSummaryWithLabels(metricName, converted);
        if (!summary) throw new Error(`Summary with name ${metricName} not found.`);

        const filtered = this._filterAllowed(summary, converted);
        if (Object.keys(filtered).length) summary.observe(filtered as any, value);
        else summary.observe(value);
    }

    static startSummaryTimer(metricName: string, labels?: Record<string, string | number | boolean>) {
        const converted = this._convertLabels(labels);
        const summary = this._ensureSummaryWithLabels(metricName, converted);
        if (!summary) throw new Error(`Summary with name ${metricName} not found.`);

        const filtered = this._filterAllowed(summary, converted);
        return Object.keys(filtered).length ? summary.startTimer(filtered as any) : summary.startTimer();
    }

    private static _wrapWithCounter<T extends (...a: any[]) => any>(original: T, options: MetricDecoratorOptions): T {
        return function (this: any, ...args: any[]) {
            let dynamicLabels: Record<string, any> = {};
            if (options.dynamicLabels) dynamicLabels = options.dynamicLabels(args) || {};

            const labels: Record<string, any> = { ...(options.labels || {}), ...dynamicLabels, error: 'none' };

            let counter = Metrics.getCounter(options.metricName);
            if (!counter) {
                Metrics.registerCounter({
                    name: options.metricName,
                    help: options.help,
                    labelNames: Object.keys(labels)
                });
                counter = Metrics.getCounter(options.metricName)!;
            }

            try {
                const res = original.apply(this, args);
                if (res instanceof Promise) {
                    return res
                        .then((v: any) => v)
                        .catch((err: any) => {
                            labels.error = err?.name || 'unknown_error';
                            throw err;
                        })
                        .finally(() => {
                            counter!.inc(labels);
                        });
                } else {
                    counter.inc(labels);
                    return res;
                }
            } catch (err: any) {
                labels.error = err?.name || 'unknown_error';
                counter.inc(labels);
                throw err;
            }
        } as unknown as T;
    }

    private static _wrapWithGauge<T extends (...a: any[]) => any>(
        original: T,
        options: MetricDecoratorOptions,
        timed: boolean
    ): T {
        return function (this: any, ...args: any[]) {
            let dynamicLabels: Record<string, any> = {};
            if (options.dynamicLabels) dynamicLabels = options.dynamicLabels(args) || {};

            const labels: Record<string, any> = { ...(options.labels || {}), ...dynamicLabels };

            let gauge = Metrics.getGauge(options.metricName);
            if (!gauge) {
                Metrics.registerGauge({
                    name: options.metricName,
                    help: options.help,
                    labelNames: Object.keys(labels)
                });
                gauge = Metrics.getGauge(options.metricName)!;
            }

            let endTimer = () => {};
            if (timed) {
                endTimer = gauge.startTimer(labels as any);
            }

            try {
                const res = original.apply(this, args);
                if (res instanceof Promise) {
                    return res
                        .then((v: any) => {
                            endTimer();
                            if (!timed && typeof v === 'number') gauge!.set(labels as any, v);
                            return v;
                        })
                        .catch((e: any) => {
                            endTimer();
                            throw e;
                        });
                } else {
                    endTimer();
                    if (!timed && typeof res === 'number') gauge.set(labels as any, res);
                    return res;
                }
            } catch (e) {
                endTimer();
                throw e;
            }
        } as unknown as T;
    }

    private static _wrapWithHistogram<T extends (...a: any[]) => any>(
        original: T,
        options: HistogramDecoratorOptions
    ): T {
        return function (this: any, ...args: any[]) {
            let dynamicLabels: Record<string, any> = {};
            if (options.dynamicLabels) dynamicLabels = options.dynamicLabels(args) || {};

            const labels: Record<string, any> = { ...(options.labels || {}), ...dynamicLabels, error: 'none' };

            let histogram = Metrics.getHistogram(options.metricName);
            if (!histogram) {
                Metrics.registerHistogram({
                    name: options.metricName,
                    help: options.help,
                    labelNames: Object.keys(labels),
                    buckets: options.buckets || undefined
                });
                histogram = Metrics.getHistogram(options.metricName)!;
            }

            const endTimer = histogram.startTimer(labels as any);

            try {
                const res = original.apply(this, args);
                if (res instanceof Promise) {
                    return res
                        .then((v: any) => {
                            endTimer();
                            return v;
                        })
                        .catch((err: any) => {
                            labels.error = err?.name || 'unknown_error';
                            endTimer();
                            throw err;
                        });
                } else {
                    endTimer();
                    return res;
                }
            } catch (err: any) {
                labels.error = err?.name || 'unknown_error';
                endTimer();
                throw err;
            }
        } as unknown as T;
    }

    private static _wrapWithSummary<T extends (...a: any[]) => any>(
        original: T,
        options: SummaryDecoratorOptions,
        timed: boolean
    ): T {
        return function (this: any, ...args: any[]) {
            let dynamicLabels: Record<string, any> = {};
            if (options.dynamicLabels) dynamicLabels = options.dynamicLabels(args) || {};

            const labels: Record<string, any> = { ...(options.labels || {}), ...dynamicLabels };

            let summary = Metrics.getSummary(options.metricName);
            if (!summary) {
                Metrics.registerSummary({
                    name: options.metricName,
                    help: options.help,
                    labelNames: Object.keys(labels),
                    percentiles: options.percentiles || undefined
                });
                summary = Metrics.getSummary(options.metricName)!;
            }

            let endTimer = () => {};
            if (timed) {
                endTimer = summary.startTimer(labels as any);
            }

            try {
                const res = original.apply(this, args);
                if (res instanceof Promise) {
                    return res
                        .then((v: any) => {
                            endTimer();
                            if (!timed && typeof v === 'number') summary!.observe(labels as any, v);
                            return v;
                        })
                        .catch((e: any) => {
                            endTimer();
                            throw e;
                        });
                } else {
                    endTimer();
                    if (!timed && typeof res === 'number') summary.observe(labels as any, res);
                    return res;
                }
            } catch (e) {
                endTimer();
                throw e;
            }
        } as unknown as T;
    }

    private static _ensureCounterWithLabels(
        metricName: string,
        labels?: Record<string, string | number | boolean>
    ): Counter<any> {
        let c = this.counters.get(metricName);
        if (c) return c;

        const cfg = this.counterConfigs.get(metricName);
        if (!cfg) return undefined as any;

        if (!cfg.labelNames || cfg.labelNames.length === 0) {
            const keys = labels ? Object.keys(labels).filter((k) => labels[k] !== undefined) : [];
            cfg.labelNames = keys;
        }
        c = new Counter(cfg as any);
        this.counters.set(metricName, c);
        return c;
    }

    private static _ensureGaugeWithLabels(
        metricName: string,
        labels?: Record<string, string | number | boolean>
    ): Gauge<any> | undefined {
        let g = this.gauges.get(metricName);
        if (g) return g;

        const cfg = this.gaugeConfigs.get(metricName);
        if (!cfg) return undefined;

        if (!cfg.labelNames || cfg.labelNames.length === 0) {
            const keys = labels ? Object.keys(labels).filter((k) => labels[k] !== undefined) : [];
            cfg.labelNames = keys;
        }
        g = new Gauge(cfg as any);
        this.gauges.set(metricName, g);
        return g;
    }

    private static _ensureHistogramWithLabels(
        metricName: string,
        labels?: Record<string, string | number | boolean>
    ): Histogram<any> | undefined {
        let h = this.histograms.get(metricName);
        if (h) return h;

        const cfg = this.histogramConfigs.get(metricName);
        if (!cfg) return undefined;

        if (!cfg.buckets) {
            cfg.buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
        }
        if (!cfg.labelNames || cfg.labelNames.length === 0) {
            const keys = labels ? Object.keys(labels).filter((k) => labels[k] !== undefined) : [];
            cfg.labelNames = keys;
        }
        h = new Histogram(cfg as any);
        this.histograms.set(metricName, h);
        return h;
    }

    private static _ensureSummaryWithLabels(
        metricName: string,
        labels?: Record<string, string | number | boolean>
    ): Summary<any> | undefined {
        let s = this.summaries.get(metricName);
        if (s) return s;

        const cfg = this.summaryConfigs.get(metricName);
        if (!cfg) return undefined;

        if (!cfg.percentiles) cfg.percentiles = [0.5, 0.9, 0.95, 0.99];
        if (!cfg.labelNames || cfg.labelNames.length === 0) {
            const keys = labels ? Object.keys(labels).filter((k) => labels[k] !== undefined) : [];
            cfg.labelNames = keys;
        }
        s = new Summary(cfg as any);
        this.summaries.set(metricName, s);
        return s;
    }

    private static _convertLabels(
        labels?: Record<string, string | number | boolean | undefined>
    ): Record<string, string | number> {
        const out: Record<string, string | number> = {};
        if (!labels) return out;
        for (const [k, v] of Object.entries(labels)) {
            if (v === undefined) continue;
            out[k] = typeof v === 'boolean' ? (v ? 'true' : 'false') : v;
        }
        return out;
    }

    private static _filterAllowed(
        metric: any,
        labels: Record<string, string | number>
    ): Record<string, string | number> {
        const allow: string[] = Array.isArray(metric?.labelNames) ? metric.labelNames : [];
        if (allow.length === 0) return {};
        return Object.fromEntries(Object.entries(labels).filter(([k]) => allow.includes(k)));
    }
}
