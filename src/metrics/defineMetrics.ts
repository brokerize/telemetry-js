import { metrics, MetricType } from './metrics.ts';

type LabelValue = string | number | boolean;

type MetricConfigBase = { help: string; labelNames?: readonly string[] };

type CounterCfg = MetricConfigBase;
type GaugeCfg = MetricConfigBase;
type HistogramCfg = MetricConfigBase & { buckets?: readonly number[] };
type SummaryCfg = MetricConfigBase;

export type MetricDefinitions = {
    counters?: Record<string, CounterCfg>;
    gauges?: Record<string, GaugeCfg>;
    histograms?: Record<string, HistogramCfg>;
    summaries?: Record<string, SummaryCfg>;
};

type LabelsFromNames<L extends readonly string[] | undefined> = L extends readonly (infer K)[]
    ? { [P in K & string]: LabelValue }
    : Record<never, never>;

type CfgFor<
    D extends MetricDefinitions,
    Kind extends keyof MetricDefinitions,
    Name extends string
> = D[Kind] extends Record<string, any> ? (Name extends keyof D[Kind] ? D[Kind][Name] : never) : never;

type NamesOf<D extends MetricDefinitions, Kind extends keyof MetricDefinitions> = D[Kind] extends Record<string, any>
    ? keyof D[Kind] & string
    : never;

export function defineMetrics<const D extends MetricDefinitions>(defs: D) {
    if (defs.counters) {
        for (const [name, cfg] of Object.entries(defs.counters)) {
            metrics.createMetric(MetricType.Counter, { name, ...cfg } as any);
        }
    }
    if (defs.gauges) {
        for (const [name, cfg] of Object.entries(defs.gauges)) {
            metrics.createMetric(MetricType.Gauge, { name, ...cfg } as any);
        }
    }
    if (defs.histograms) {
        for (const [name, cfg] of Object.entries(defs.histograms)) {
            metrics.createMetric(MetricType.Histogram, { name, ...cfg } as any);
        }
    }
    if (defs.summaries) {
        for (const [name, cfg] of Object.entries(defs.summaries)) {
            metrics.createMetric(MetricType.Summary, { name, ...cfg } as any);
        }
    }

    type CounterName = NamesOf<D, 'counters'>;
    type GaugeName = NamesOf<D, 'gauges'>;
    type HistogramName = NamesOf<D, 'histograms'>;
    type SummaryName = NamesOf<D, 'summaries'>;

    return {
        defs,

        incrementCounter<N extends CounterName>(
            name: N,
            labels: LabelsFromNames<CfgFor<D, 'counters', N>['labelNames']> = {} as any,
            value?: number
        ) {
            metrics.incrementCounter(name, labels as any, value);
        },

        setGauge<N extends GaugeName>(
            name: N,
            value: number,
            labels: LabelsFromNames<CfgFor<D, 'gauges', N>['labelNames']> = {} as any
        ) {
            metrics.setGauge(name, value, labels as any);
        },

        observeHistogram<N extends HistogramName>(
            name: N,
            value: number,
            labels: LabelsFromNames<CfgFor<D, 'histograms', N>['labelNames']> = {} as any
        ) {
            metrics.observeHistogram(name, value, labels as any);
        },

        observeSummary<N extends SummaryName>(
            name: N,
            value: number,
            labels: LabelsFromNames<CfgFor<D, 'summaries', N>['labelNames']> = {} as any
        ) {
            metrics.observeSummary(name, value, labels as any);
        },
        async getMetrics() {
            return metrics.getMetrics();
        }
    };
}
