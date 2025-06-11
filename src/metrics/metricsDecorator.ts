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
    labels?: Record<string, string>; // Statische Labels, die immer gesetzt werden
    dynamicLabels?: (args: any[]) => Record<string, string | number | boolean>; // Funktion zum Generieren dynamischer Labels
}

export interface HistogramDecoratorOptions extends MetricDecoratorOptions {
    buckets?: number[]; // Optional: Manuelle Definition der Buckets für das Histogramm
}

export interface SummaryDecoratorOptions extends MetricDecoratorOptions {
    percentiles?: number[]; // Optional: Manuelle Definition der Percentile für das Summary
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

    // Counter methods
    static registerCounter<T extends string>(counterConfig: CounterConfiguration<T>) {
        if (counterConfig.collect) {
            //create the new counter immediately
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
        const counter = this.getCounter(metricName);
        if (counter) {
            if (labels) {
                // Konvertiere boolean zu string
                const convertedLabels: Record<string, string | number> = {};
                for (const [key, value] of Object.entries(labels)) {
                    if (value !== undefined) {
                        convertedLabels[key] = typeof value === 'boolean' ? (value ? 'true' : 'false') : value;
                    }
                }
                counter.inc(convertedLabels, incrementValue);
            } else {
                counter.inc(incrementValue);
            }
        } else {
            throw new Error(`Counter with name ${metricName} not found.`);
        }
    }

    static counter = (options: MetricDecoratorOptions) => {
        return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
            const originalMethod = descriptor.value;

            descriptor.value = function (...args: any[]) {
                let dynamicLabels = {};

                // Generiere dynamische Labels basierend auf den Funktionsargumenten
                if (options.dynamicLabels) {
                    dynamicLabels = options.dynamicLabels(args);
                }

                const labels = {
                    ...(options.labels || {}),
                    ...dynamicLabels,
                    error: 'none'
                };

                // Zähler inkrementieren oder erstellen, falls noch nicht vorhanden
                let counter = Metrics.getCounter(options.metricName);
                if (!counter) {
                    Metrics.registerCounter({
                        name: options.metricName,
                        help: options.help,
                        labelNames: Object.keys(labels).length > 0 ? Object.keys(labels) : undefined
                    });
                    counter = Metrics.getCounter(options.metricName)!;
                }

                try {
                    const result = originalMethod.apply(this, args);

                    if (result instanceof Promise) {
                        return result
                            .then((res) => {
                                return res;
                            })
                            .catch((err) => {
                                labels.error = err.name || 'unknown_error';
                                throw err;
                            })
                            .finally(() => {
                                counter.inc(labels);
                            });
                    } else {
                        counter.inc(labels);
                        return result;
                    }
                } catch (err: any) {
                    labels.error = err.name || 'unknown_error';
                    counter.inc(labels);
                    throw err;
                }
            };

            return descriptor;
        };
    };

    // Gauge methods
    static registerGauge<T extends string>(gaugeConfig: GaugeConfiguration<T>) {
        if (gaugeConfig.collect) {
            //create the new gauge immediately
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
        const gauge = this.getGauge(metricName);
        if (gauge) {
            if (labels) {
                // Konvertiere boolean zu string
                const convertedLabels: Record<string, string | number> = {};
                for (const [key, value] of Object.entries(labels)) {
                    convertedLabels[key] = typeof value === 'boolean' ? (value ? 'true' : 'false') : value;
                }
                gauge.set(convertedLabels, value);
            } else {
                gauge.set(value);
            }
        } else {
            throw new Error(`Gauge with name ${metricName} not found.`);
        }
    }

    static startGaugeTimer(metricName: string, labels?: Record<string, string | number | boolean>) {
        const gauge = this.getGauge(metricName);
        if (gauge) {
            if (labels) {
                // Konvertiere boolean zu string
                const convertedLabels: Record<string, string | number> = {};
                for (const [key, value] of Object.entries(labels)) {
                    convertedLabels[key] = typeof value === 'boolean' ? (value ? 'true' : 'false') : value;
                }
                return gauge.startTimer(convertedLabels);
            } else {
                return gauge.startTimer();
            }
        } else {
            throw new Error(`Gauge with name ${metricName} not found.`);
        }
    }

    static gauge = (options: MetricDecoratorOptions, timed: boolean = false) => {
        return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
            const originalMethod = descriptor.value;

            descriptor.value = function (...args: any[]) {
                let dynamicLabels = {};

                if (options.dynamicLabels) {
                    dynamicLabels = options.dynamicLabels(args);
                }

                const labels = {
                    ...(options.labels || {}),
                    ...dynamicLabels
                };

                let gauge = Metrics.getGauge(options.metricName);
                if (!gauge) {
                    Metrics.registerGauge({
                        name: options.metricName,
                        help: options.help,
                        labelNames: Object.keys(labels).length > 0 ? Object.keys(labels) : undefined
                    });
                    gauge = Metrics.getGauge(options.metricName)!;
                }

                let endTimer = () => {};
                if (timed) {
                    endTimer = gauge.startTimer(labels);
                }

                try {
                    const result = originalMethod.apply(this, args);

                    if (result instanceof Promise) {
                        return result
                            .then((res) => {
                                endTimer();
                                if (!timed && typeof res === 'number') {
                                    gauge.set(labels, res);
                                }
                                return res;
                            })
                            .catch((err) => {
                                endTimer();
                                throw err;
                            });
                    } else {
                        endTimer();
                        if (!timed && typeof result === 'number') {
                            gauge.set(labels, result);
                        }
                        return result;
                    }
                } catch (err) {
                    endTimer();
                    throw err;
                }
            };

            return descriptor;
        };
    };

    // Histogram methods
    static registerHistogram<T extends string>(histogramConfig: HistogramConfiguration<T>) {
        if (!histogramConfig.buckets) {
            histogramConfig.buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
        }
        if (histogramConfig.collect) {
            //create the new histogram immediately
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
        const histogram = this.getHistogram(metricName);
        if (histogram) {
            if (labels) {
                // Konvertiere boolean zu string
                const convertedLabels: Record<string, string | number> = {};
                for (const [key, value] of Object.entries(labels)) {
                    convertedLabels[key] = typeof value === 'boolean' ? (value ? 'true' : 'false') : value;
                }
                histogram.observe(convertedLabels, value);
            } else {
                histogram.observe(value);
            }
        } else {
            throw new Error(`Histogram with name ${metricName} not found.`);
        }
    }

    static histogram = (options: HistogramDecoratorOptions) => {
        return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
            const originalMethod = descriptor.value;

            descriptor.value = function (...args: any[]) {
                let dynamicLabels = {};

                if (options.dynamicLabels) {
                    dynamicLabels = options.dynamicLabels(args);
                }

                const labels = {
                    ...(options.labels || {}),
                    ...dynamicLabels,
                    error: 'none' // Standardwert für das Fehlerlabel
                };

                let histogram = Metrics.getHistogram(options.metricName);
                if (!histogram) {
                    Metrics.registerHistogram({
                        name: options.metricName,
                        help: options.help,
                        labelNames: Object.keys(labels).length > 0 ? Object.keys(labels) : undefined,
                        buckets: options.buckets || undefined
                    });
                    histogram = Metrics.getHistogram(options.metricName)!;
                }

                const endTimer = histogram.startTimer(labels); // Start der Zeitmessung

                try {
                    const result = originalMethod.apply(this, args);

                    if (result instanceof Promise) {
                        return result
                            .then((res) => {
                                endTimer();
                                return res;
                            })
                            .catch((err) => {
                                labels.error = err.name || 'unknown_error';
                                endTimer();
                                throw err;
                            });
                    } else {
                        endTimer();
                        return result;
                    }
                } catch (err: any) {
                    labels.error = err.name || 'unknown_error';
                    endTimer();
                    throw err;
                }
            };

            return descriptor;
        };
    };

    // Summary methods
    static registerSummary<T extends string>(summaryConfig: SummaryConfiguration<T>) {
        if (!summaryConfig.percentiles) {
            summaryConfig.percentiles = [0.5, 0.9, 0.95, 0.99];
        }
        if (summaryConfig.collect) {
            //create the new summary immediately
            this.summaries.set(summaryConfig.name, new Summary(summaryConfig));
        } else {
            this.summaryConfigs.set(summaryConfig.name, summaryConfig);
        }
    }

    static summary = (options: SummaryDecoratorOptions, timed: boolean = false) => {
        return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
            const originalMethod = descriptor.value;

            descriptor.value = function (...args: any[]) {
                let dynamicLabels = {};

                if (options.dynamicLabels) {
                    dynamicLabels = options.dynamicLabels(args);
                }

                const labels = {
                    ...(options.labels || {}),
                    ...dynamicLabels
                };

                let summary = Metrics.getSummary(options.metricName);
                if (!summary) {
                    Metrics.registerSummary({
                        name: options.metricName,
                        help: options.help,
                        labelNames: Object.keys(labels).length > 0 ? Object.keys(labels) : undefined,
                        percentiles: options.percentiles || undefined
                    });
                    summary = Metrics.getSummary(options.metricName)!;
                }
                let endTimer = () => {};
                if (timed) {
                    endTimer = summary.startTimer(labels);
                }

                try {
                    const result = originalMethod.apply(this, args);

                    if (result instanceof Promise) {
                        return result
                            .then((res) => {
                                endTimer();
                                if (!timed && typeof res === 'number') {
                                    summary.observe(labels, res);
                                }
                                return res;
                            })
                            .catch((err) => {
                                endTimer();
                                throw err;
                            });
                    } else {
                        endTimer();
                        if (!timed && typeof result === 'number') {
                            summary.observe(labels, result);
                        }
                        return result;
                    }
                } catch (err) {
                    endTimer();
                    throw err;
                }
            };

            return descriptor;
        };
    };

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
        const summary = this.getSummary(metricName);
        if (summary) {
            if (labels) {
                // Konvertiere boolean zu string
                const convertedLabels: Record<string, string | number> = {};
                for (const [key, value] of Object.entries(labels)) {
                    convertedLabels[key] = typeof value === 'boolean' ? (value ? 'true' : 'false') : value;
                }
                summary.observe(convertedLabels, value);
            } else {
                summary.observe(value);
            }
        } else {
            throw new Error(`Summary with name ${metricName} not found.`);
        }
    }

    static startSummaryTimer(metricName: string, labels?: Record<string, string | number | boolean>) {
        const summary = this.getSummary(metricName);
        if (summary) {
            if (labels) {
                // Konvertiere boolean zu string
                const convertedLabels: Record<string, string | number> = {};
                for (const [key, value] of Object.entries(labels)) {
                    convertedLabels[key] = typeof value === 'boolean' ? (value ? 'true' : 'false') : value;
                }
                return summary.startTimer(convertedLabels);
            } else {
                return summary.startTimer();
            }
        } else {
            throw new Error(`Summary with name ${metricName} not found.`);
        }
    }
}
