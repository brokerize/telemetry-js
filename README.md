# @brokerize/telemetry

[![CI](https://github.com/brokerize/telemetry-js/actions/workflows/ci.yml/badge.svg)](https://github.com/brokerize/telemetry-js/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@brokerize/telemetry.svg)](https://www.npmjs.com/package/@brokerize/telemetry)

A TypeScript package for integrating **metrics** and **tracing** into your applications, leveraging OpenTelemetry for standardized observability.

## Overview

`@brokerize/telemetry` provides tools to monitor application performance and behavior via **metrics** (counters, gauges, histograms, summaries) and **tracing** (spans across distributed systems). It simplifies instrumentation with decorator-based and manual APIs, making it easy to adopt incrementally in TypeScript projects.

## Getting Started

### Installation

Install the package via npm:

```bash
npm install @brokerize/telemetry
```

### Initialization

Initialize OpenTelemetry with `initInstrumentation`. This sets up the context manager, exporter/processors, and optional auto-instrumentations.

```ts
import { initInstrumentation } from '@brokerize/telemetry';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';

initInstrumentation({
  serviceName: 'my-service',
  instrumentations: [new HttpInstrumentation()],

  // (Optional) Global behavior for withTracing:
  tracingMode: 'natural-sync-async', // or 'legacy-always-promise' (deprecated)

  // (Optional) Span limits (passing this also enables span limits)
  // spanLimits: { attributeValueLengthLimit: 12000, attributeCountLimit: 128, ... }

  // ── Exporter/Processor configuration ────────────────────────────────────────
  // EITHER: provide an exporter descriptor (simple path; library creates a BatchSpanProcessor)
  exporter: { kind: 'otlp', url: 'http://your-otel-collector:4318/v1/traces' },
  // exporter: { kind: 'console' } // for local debugging
  // exporter: { kind: 'noop' }    // no-op exporting

  // OR: provide your own processors (full control; library will NOT add any by itself)
  // spanProcessors: [
  //   new BatchSpanProcessor(new OTLPTraceExporter({ url: 'http://your-otel-collector:4318/v1/traces' })),
  // ],
});
```

> **Note:** Call `initInstrumentation` **once at application startup** (e.g., in `instrumentation.ts` or your entry file) **before** using any metrics or tracing APIs.

### Exporter & Span Processor Precedence

You can configure exporting in two ways. The library follows these rules:

1. **You provide `spanProcessors`** → *Your processors are used as-is.* The library will **not** attach any exporter or default processor.
2. **You do not provide `spanProcessors`** but provide an **`exporter`** → The library creates a **`BatchSpanProcessor(exporter)`** for you (except for `noop`, which results in no processors).
3. **You provide neither** → Tracing runs with **no exporter** (no-op).

> **Legacy compatibility:** You can still pass `url` (OTLP) and/or `localDebugging: true` (console) instead of `exporter`. These are deprecated and mapped internally to the exporter descriptor. Prefer `exporter: { kind: ... }` going forward.

## Key Features

### Metrics

The `Metrics` class and the `metrics` helper expose counters, gauges, histograms, and summaries. Use decorators for automatic metric recording, or call the API directly for fine-grained control. Lazy creation is preserved—metrics are instantiated on the first real measurement.

#### Decorator Compatibility (TC39 + legacy)

The metrics decorators (`@Metrics.counter`, `@Metrics.gauge`, `@Metrics.histogram`, `@Metrics.summary`) support both the **TC39 decorator signature** `(value, ctx)` for `method/getter/setter/field/auto-accessor`, and the **legacy TypeScript decorator** signature `(target, key, descriptor)`. Use either style based on your TypeScript configuration.

#### Example: Using Decorators

```ts
import { Metrics } from '@brokerize/telemetry';

class ExampleService {
  @Metrics.counter({
    metricName: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labels: { method: 'GET' },
  })
  handleRequest() {
    // Implementation
  }
}
```

#### Example: Manual Metric Creation

```ts
import { metrics, MetricType } from '@brokerize/telemetry';

metrics.createMetric(MetricType.Counter, {
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'status'],
});

// Instance is lazily created on first measurement:
metrics.incrementCounter('http_requests_total', { method: 'GET', status: '200' });
```

#### Recommended (v2.0.4): Typed Metric Definitions (`defineMetrics`)

When metrics are registered manually using `metrics.createMetric(...)`, the metric name is a plain `string`. TypeScript cannot validate at compile time that the name exists.

To get compile-time checking for metric names (and optionally labels), define your metrics once using `defineMetrics(...)` and use the returned typed helper to update them.

```ts
import { defineMetrics } from '@brokerize/telemetry';

export const telemetry = defineMetrics({
  counters: {
    http_requests_total: {
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'status'] as const
    }
  },

  gauges: {
    app_active_users: {
      help: 'Number of currently active users'
    }
  }
} as const);
```

Usage:

```ts
import { telemetry } from './telemetry';

telemetry.incrementCounter('http_requests_total', { method: 'GET', status: '200' }); // ✅
telemetry.incrementCounter('does_not_exist_total'); // ❌ compile-time error
telemetry.incrementCounter('http_requests_total', { foo: 'bar' }); // ❌ compile-time error (label not allowed)
```

Notes:
- `defineMetrics(...)` **registers metrics immediately**. Call it during startup.
- Avoid registering the same metric twice (e.g., `defineMetrics(...)` and separate `metrics.createMetric(...)` for the same name).

For detailed usage, see `./docs/telemetry/metrics.md`.

### Tracing

The `Traces` class enables tracing of operations using OpenTelemetry spans. Use the `@Traces.trace` decorator for automatic span creation, or call helper APIs for custom logic.

#### Decorator Compatibility (TC39 + legacy)

`@Traces.trace` supports both the **TC39 decorator signature** `(value, ctx)` for `method/getter/setter/field/auto-accessor`, and the **legacy TypeScript decorator** signature `(target, key, descriptor)`. Sync/async semantics and `this` binding are preserved across both paths.

#### Start Modes (New)

A **Start Mode** defines how a span is created relative to the active context:

- `'reuse'` – Reuse the current active span if present; otherwise create a new one.
- `'createChild'` – Always create a new span; it will be a child if a parent is active, otherwise a root span.
- `'newTrace'` – Always create a new **root** span (new trace).
- `'newTraceWithLink'` – Always create a new **root** span and link it to the current active span (if any).

> **Recommended:** Use `startMode` instead of the legacy `createNewSpan` flag. The flag is still supported for now, but will be removed in a future release.

#### Example: Using Decorators

```ts
import { Traces } from '@brokerize/telemetry';

class ExampleService {
  @Traces.trace({
    spanName: 'fetch-data',
    attributes: { endpoint: '/api/data' },
    startMode: 'createChild', // recommended
  })
  async fetchData() {
    // Implementation
    return { status: 'success' };
  }
}
```

#### Example: Manual Tracing (recommended API)

```ts
import { Traces, SpanStatusCode } from '@brokerize/telemetry';

async function processRequest() {
  // New API: getSpan with StartMode
  const { span, createdSpan } = Traces.getSpan(
    'process-request',
    { attributes: { operation: 'process' } },
    'createChild', // startMode
    'app'          // moduleName (optional)
  );

  try {
    // Implementation
    Traces.setStatus({ code: SpanStatusCode.OK });
  } catch (error: any) {
    Traces.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    throw error;
  } finally {
    if (createdSpan) span.end();
  }
}
```

> **Legacy helper** `getCurrentSpanOrCreateNew(spanName, options, createNewSpan, moduleName)` is still supported, but prefer `getSpan(spanName, options, startMode, moduleName)` going forward. Likewise, prefer `startMode` over `createNewSpan`.

## Changes in v2.x

### Metrics (v2.0.4)

- **New:** `defineMetrics(...)` helper that lets consumers define metrics once and get **TypeScript-checked** metric names (and optional label checking).
- Existing APIs (`metrics.createMetric(...)`, `metrics.incrementCounter(...)`, decorators) continue to work.

### Initialization changes (exporters & processors)

- **New exporter input** via `exporter: { kind: 'otlp' | 'console' | 'noop', ... }` or a concrete `SpanExporter` instance.
- **Precedence:**  
  1) If `spanProcessors` is provided ⇒ used **as-is** (no implicit defaults).  
  2) Else if `exporter` is provided ⇒ default **`BatchSpanProcessor(exporter)`** is attached (except for `noop`).  
  3) Else ⇒ no exporter/processors (no-op exporting).
- **Legacy flags** `url`, `localDebugging`, `concurrencyLimit` are supported but **deprecated**; prefer `exporter`.

### `withTracing` Behavior (Sync vs. Async)

> **New (opt-in, non-breaking):**  
> `withTracing` behaves **naturally**: **synchronous** functions remain synchronous (no artificial Promise), **asynchronous** functions continue to return a Promise.  
> For backward compatibility, a **legacy mode** forces **all** wrapped calls to return a Promise.

#### Modes

| Mode | Description | How to enable |
| --- | --- | --- |
| `natural-sync-async` (default) | Sync functions stay sync; async functions return a Promise. | `initInstrumentation({ tracingMode: 'natural-sync-async' })` or `TRACES_MODE=natural-sync-async` |
| `legacy-always-promise` (deprecated) | **All** functions return a Promise, including sync functions. | `initInstrumentation({ tracingMode: 'legacy-always-promise' })` or `TRACES_MODE=legacy-always-promise` |

When legacy mode is active, a one-time **deprecation warning** is logged. Please migrate to `natural-sync-async`.

### Span Limits (Feature Flag)

Span limits help prevent unbounded memory usage by constraining attribute sizes/counts, event counts, and link counts.

- **Disabled by default** (to avoid surprise behavior changes).  
- You can enable limits via:
  - **Environment:** `TRACES_ENABLE_LIMITS=1`
  - **Code:** pass `spanLimits` in `initInstrumentation(...)` (this also enables limits).

When enabled without providing your own values, the following **defaults** are applied:

```ts
{
  attributeValueLengthLimit: 12000,
  attributeCountLimit: 128,
  eventCountLimit: 128,
  linkCountLimit: 128,
  attributePerEventCountLimit: 16,
  attributePerLinkCountLimit: 16
}
```

> A one-time warning is logged when limits are **disabled** to encourage adoption. Future versions may enable limits by default.

#### Examples

**Enable via environment:**

```bash
export TRACES_ENABLE_LIMITS=1
```

**Enable and customize via code:**

```ts
initInstrumentation({
  serviceName: 'my-service',
  exporter: { kind: 'otlp', url: 'http://your-otel-collector:4318/v1/traces' },
  spanLimits: {
    attributeValueLengthLimit: 8000,
    attributeCountLimit: 64,
    eventCountLimit: 256,
    linkCountLimit: 32,
  },
});
```

### Migration Guide

Most users do not need changes. Consider the following updates:

#### 1) Replace `createNewSpan` with `startMode` (recommended)

**Before (legacy):**
```ts
@Traces.trace({ spanName: 'op', createNewSpan: true })
```

**After (recommended):**
```ts
@Traces.trace({ spanName: 'op', startMode: 'createChild' })
```

#### 2) Replace `getCurrentSpanOrCreateNew` with `getSpan`

**Before (legacy helper):**
```ts
const { span, createdSpan } = Traces.getCurrentSpanOrCreateNew('op', { attributes: {...} }, true);
```

**After (recommended):**
```ts
const { span, createdSpan } = Traces.getSpan('op', { attributes: {...} }, 'createChild');
```

#### 3) Check for sync call sites using `.then(...)`

If a wrapped synchronous function was treated as Promise:
- temporarily enable `legacy-always-promise`, or
- refactor call sites to use direct returns.

#### 4) Adopt span limits

- Enable via `TRACES_ENABLE_LIMITS=1` or pass `spanLimits` in code.
- Be aware future versions may enable limits by default.

#### Checklist

1. Choose a global mode (`tracingMode` or `TRACES_MODE`).  
2. Replace `createNewSpan` → `startMode` where possible.  
3. Replace `getCurrentSpanOrCreateNew` → `getSpan`.  
4. Search for `.then(` on call sites of sync functions and migrate as needed.  
5. Decide whether to enable `spanLimits` now (env or code).  
6. Watch for one-time deprecation and limits warnings.

### Deprecations

- `createNewSpan` is **deprecated**. Use `startMode: 'createChild'` instead.
- `getCurrentSpanOrCreateNew` is **deprecated**. Use `getSpan(spanName, options, startMode, moduleName)` instead.
- Global `legacy-always-promise` mode is **deprecated** and intended for migration only.
- Span limits are currently opt-in; future versions may enable them by default.

## Examples

### Job Handling with Attributes

```ts
await Traces.withTracing(
  jobQueueService.handleJob.bind(jobQueueService),
  {
    spanName: 'jobQueueService.handleJob',
    attributes: {
      jobId,
      msg_action: msg.action,
      queueTimes_delaySeconds: msg.queueTimes?.delaySeconds,
      queueTimes_queuedAt: msg.queueTimes?.queuedAt,
    },
    startMode: 'createChild',
  }
)(job, timeout);
```

### Decorator with Dynamic Attributes and Conditional Tracing

```ts
class OrderService {
  @Traces.trace({
    spanName: 'processOrder',
    attributes: { service: 'order' },
    dynamicAttributes: (args) => ({ orderId: args[0] }),
    startMode: 'createChild',
    traceOnlyIf: (args, self, currentSpan) => process.env.ENABLE_TRACING === '1',
  })
  async processOrder(orderId: string) {
    // ...
  }
}
```

## Docs

- **Metrics**: Learn how to define and use metrics in [docs/telemetry/metrics.md](./docs/telemetry/metrics.md).
- **Tracing**: For detailed usage, see [docs/telemetry/tracing.md](./docs/telemetry/tracing.md).