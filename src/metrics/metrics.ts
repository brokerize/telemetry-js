import * as PromClient from 'prom-client';

import { Metrics } from './metricsDecorator.ts';
import { CounterConfiguration, GaugeConfiguration, HistogramConfiguration, SummaryConfiguration } from 'prom-client';

export const httpRequestDurationMicroseconds = new PromClient.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Dauer von HTTP-Anfragen in Sekunden',
    labelNames: ['method', 'status_code'],
    buckets: [0.005, 0.01, 0.05, 0.1, 0.5, 1, 5]
});

export const httpRequestCounter = new PromClient.Counter({
    name: 'http_requests_total',
    help: 'Anzahl der HTTP-Anfragen',
    labelNames: ['method', 'route', 'status_code']
});

export const httpRequestDurationSum = new PromClient.Counter({
    name: 'http_request_duration_sum',
    help: 'Summe der Dauer von HTTP-Anfragen',
    labelNames: ['method', 'route', 'status_code']
});

export function createMetric(type: MetricType.Counter, config: CounterConfiguration<string>): void;
export function createMetric(type: MetricType.Gauge, config: GaugeConfiguration<string>): void;
export function createMetric(type: MetricType.Histogram, config: HistogramConfiguration<string>): void;
export function createMetric(type: MetricType.Summary, config: SummaryConfiguration<string>): void;
export function createMetric(
    type: MetricType,
    config:
        | CounterConfiguration<string>
        | PromClient.GaugeConfiguration<string>
        | PromClient.HistogramConfiguration<string>
        | PromClient.SummaryConfiguration<string>
): void {
    switch (type) {
        case MetricType.Counter:
            return Metrics.registerCounter(config as CounterConfiguration<string>);
        case MetricType.Gauge:
            return Metrics.registerGauge(config as PromClient.GaugeConfiguration<string>);
        case MetricType.Histogram:
            return Metrics.registerHistogram(config as PromClient.HistogramConfiguration<string>);
        case MetricType.Summary:
            return Metrics.registerSummary(config as PromClient.SummaryConfiguration<string>);
        default:
            throw new Error(`Unsupported metric type: ${type}`);
    }
}

export enum MetricType {
    Counter = 'Counter',
    Gauge = 'Gauge',
    Histogram = 'Histogram',
    Summary = 'Summary'
}

PromClient.collectDefaultMetrics();

export const metrics = {
    async getMetrics() {
        return {
            contentType: PromClient.register.contentType,
            data: await PromClient.register.metrics()
        };
    },

    incrementCounter(name: string, labels: Record<string, string | number | boolean> = {}, incrementValue?: number) {
        Metrics.incrementCounter(name, labels, incrementValue);
    },

    setGauge(name: string, value: number, labels: Record<string, string | number | boolean> = {}) {
        Metrics.setGauge(name, value, labels);
    },

    startGaugeTimer(name: string, labels: Record<string, string | number | boolean> = {}) {
        return Metrics.startGaugeTimer(name, labels);
    },

    observeHistogram(name: string, value: number, labels: Record<string, string | number | boolean> = {}) {
        Metrics.observeHistogram(name, value, labels);
    },

    observeSummary(name: string, value: number, labels: Record<string, string | number | boolean> = {}) {
        Metrics.observeSummary(name, value, labels);
    },

    startSummaryTimer(name: string, labels: Record<string, string | number | boolean> = {}) {
        return Metrics.startSummaryTimer(name, labels);
    },

    createMetric
};
