# @brokerize/telemetry

A TypeScript package for integrating metrics and tracing into your applications, leveraging OpenTelemetry for standardized observability.

## Overview

The `@brokerize/telemetry` package provides tools to monitor application performance and behavior through **metrics** (for numerical data like counters, gauges, histograms, and summaries) and **tracing** (for tracking request flows across distributed systems). It simplifies instrumentation with annotation-based and manual approaches, making it easy to integrate into existing TypeScript projects.

## Getting Started

### Installation

Install the package via npm:

```bash
npm install @brokerize/telemetry
```

### Initialization

Before using metrics or tracing, initialize the OpenTelemetry instrumentation with the `initInstrumentation` function. This sets up the exporter for sending telemetry data to an OpenTelemetry collector.

```typescript
import { initInstrumentation } from '@brokerize/telemetry';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';

initInstrumentation({
    serviceName: 'my-service',
    url: 'http://your-otel-collector:4318/v1/traces',
    localDebugging: false,
    instrumentations: [new HttpInstrumentation()]
});
```

> **Note**: Call `initInstrumentation` at the start of your application, e.g., in an `instrumentation.ts` file. See [Initializing Instrumentation](./docs/telemetry/tracing.md#initializing-instrumentation) for more details.]

## Key Features

### Metrics

The `Metrics` class and `metrics` wrapper allow you to create and manage metrics such as counters, gauges, histograms, and summaries. Use annotations for automatic metric creation or manual methods for fine-grained control.

#### Example: Using Annotations

```typescript
import { Metrics } from '@brokerize/telemetry';

class ExampleService {
    @Metrics.counter({
        metricName: 'http_requests_total',
        help: 'Total number of HTTP requests',
        labels: { method: 'GET' }
    })
    handleRequest() {
        // Implementation
    }
}
```

#### Example: Manual Metric Creation

```typescript
import { metrics, MetricType } from '@brokerize/telemetry';

metrics.createMetric(MetricType.Counter, {
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'status']
});

metrics.incrementCounter('http_requests_total', { method: 'GET', status: '200' });
```

For detailed usage, see [Metrics](./docs/telemetry/metrics.md).

### Tracing

The `Traces` class enables tracing of operations using OpenTelemetry spans. Use the `@Trace` annotation for automatic span creation or manual methods for custom tracing logic.

#### Example: Using Annotations

```typescript
import { Traces } from '@brokerize/telemetry';

class ExampleService {
    @Traces.trace({
        spanName: 'fetch-data',
        attributes: { endpoint: '/api/data' }
    })
    async fetchData() {
        // Implementation
        return { status: 'success' };
    }
}
```

#### Example: Manual Tracing

```typescript
import { Traces, SpanStatusCode } from '@brokerize/telemetry';

async function processRequest() {
    const { span, createdSpan } = Traces.getCurrentSpanOrCreateNew('process-request', {
        attributes: { operation: 'process' }
    });

    try {
        // Implementation
        Traces.setStatus({ code: SpanStatusCode.OK });
    } catch (error) {
        Traces.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        throw error;
    } finally {
        if (createdSpan) span.end();
    }
}
```

For detailed usage, see [Tracing](./docs/telemetry/tracing.md).

## Documentation

- **Metrics**: Learn how to define and use metrics in [Metrics.md](./docs/telemetry/metrics.md).
- **Tracing**: Understand tracing and span management in [Tracing.md](./docs/telemetry/tracing.md).