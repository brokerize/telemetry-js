import { metrics, MetricType } from './metrics.ts';
import type {
    CounterConfiguration,
    GaugeConfiguration,
    HistogramConfiguration,
    SummaryConfiguration
} from 'prom-client';

type LabelValue = string | number | boolean;

type CounterCfgBase<L extends readonly string[] | undefined> = Omit<
    CounterConfiguration<string>,
    'name' | 'help' | 'labelNames'
> & {
    help: string;
    labelNames?: L;
};

type CounterCfg = CounterCfgBase<readonly string[] | undefined>;

type GaugeCfg = Omit<GaugeConfiguration<string>, 'name' | 'help' | 'labelNames'> & {
    help: string;
    labelNames?: readonly string[];
};

type HistogramCfg = Omit<HistogramConfiguration<string>, 'name' | 'help' | 'labelNames' | 'buckets'> & {
    help: string;
    labelNames?: readonly string[];
    buckets?: readonly number[];
};

type SummaryCfg = Omit<SummaryConfiguration<string>, 'name' | 'help' | 'labelNames' | 'percentiles'> & {
    help: string;
    labelNames?: readonly string[];
    percentiles?: readonly number[];
};

export type MetricDefinitions = {
    counters?: Record<string, CounterCfg>;
    gauges?: Record<string, GaugeCfg>;
    histograms?: Record<string, HistogramCfg>;
    summaries?: Record<string, SummaryCfg>;
};

type NamesOf<D extends MetricDefinitions, Kind extends keyof MetricDefinitions> = D[Kind] extends Record<string, any>
    ? keyof D[Kind] & string
    : never;

type CfgFor<
    D extends MetricDefinitions,
    Kind extends keyof MetricDefinitions,
    Name extends string
> = D[Kind] extends Record<string, any> ? (Name extends keyof D[Kind] ? D[Kind][Name] : never) : never;

type LabelsFromNames<L extends readonly string[] | undefined> = L extends readonly (infer K)[]
    ? { [P in K & string]: LabelValue }
    : Record<never, never>;

type LabelsFor<D extends MetricDefinitions, Kind extends keyof MetricDefinitions, N extends string> = LabelsFromNames<
    CfgFor<D, Kind, N>['labelNames']
>;

// If labels are empty => labels arg optional, otherwise required
type LabelsArg<Labels extends Record<string, any>, V> = [keyof Labels] extends [never]
    ? [labels?: Labels, value?: V]
    : [labels: Labels, value?: V];

type OnlyLabelsArg<Labels extends Record<string, any>> = [keyof Labels] extends [never]
    ? [labels?: Labels]
    : [labels: Labels];

export function defineMetrics<const D extends MetricDefinitions>(defs: D) {
    // --- register (runtime) ---
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
            ...metricContent: LabelsArg<LabelsFor<D, 'counters', N>, number>
        ) {
            const [labels, value] = metricContent as [Record<string, LabelValue> | undefined, number | undefined];
            metrics.incrementCounter(name, labels ?? {}, value);
        },

        setGauge<N extends GaugeName>(
            name: N,
            value: number,
            ...metricContent: OnlyLabelsArg<LabelsFor<D, 'gauges', N>>
        ) {
            const [labels] = metricContent as [Record<string, LabelValue> | undefined];
            metrics.setGauge(name, value, labels ?? {});
        },

        observeHistogram<N extends HistogramName>(
            name: N,
            value: number,
            ...metricContent: OnlyLabelsArg<LabelsFor<D, 'histograms', N>>
        ) {
            const [labels] = metricContent as [Record<string, LabelValue> | undefined];
            metrics.observeHistogram(name, value, labels ?? {});
        },

        observeSummary<N extends SummaryName>(
            name: N,
            value: number,
            ...metricContent: OnlyLabelsArg<LabelsFor<D, 'summaries', N>>
        ) {
            const [labels] = metricContent as [Record<string, LabelValue> | undefined];
            metrics.observeSummary(name, value, labels ?? {});
        },

        async getMetrics() {
            return metrics.getMetrics();
        }
    };
}
