# Tracing

This document describes how tracing is used within the project to track application workflows and analyze performance and errors.

## Overview

Tracing tracks requests and internal processes by creating **spans**. A span represents a single operation (e.g., an HTTP request, a DB query, or a function). Spans form a hierarchy to express causal relations and include timestamps, attributes, and error/status information. The implementation is based on **OpenTelemetry**.

### Goals of Tracing

- **Traceability**: Follow requests across system boundaries.
- **Performance Analysis**: Identify bottlenecks and latency.
- **Error Diagnosis**: Capture and analyze failures.
- **Context Propagation**: Connect operations using trace/span IDs.

---

## Technical Implementation

Tracing is implemented via the `Traces` class, which provides helpers for creating and managing spans, setting attributes and status, and recording exceptions and events. It uses the OpenTelemetry API under the hood.

---

## Using Tracing

You can instrument code **automatically** with the `@Traces.trace` decorator or **manually** with `Traces` helpers.

### Usage via Decorators

The `@Traces.trace` decorator instruments a method: it creates (or reuses) a span, attaches attributes, manages status/error handling, and ends the span automatically.

> **Decorator compatibility:** Supports both **TC39** decorators (`(value, ctx)` for `method/getter/setter/field/auto-accessor`) **and** legacy **TypeScript** decorators (`(target, key, descriptor)`).

```ts
@Traces.trace(options)
```

**Options**:

- `spanName` (_optional_): Span name. Defaults to the method name.
- `attributes` (_optional_): Static key‑value pairs added as span attributes.
- `dynamicAttributes` (_optional_): `(args) => Record<string, any>` computed per invocation; keys overwrite `attributes` on conflict.
- `moduleName` (_optional_): Logical tracer name; defaults to the caller file.
- `traceOnlyIf` (_optional_): `boolean | (args, thisContext, currentSpan?) => boolean` to conditionally enable tracing.
- `startMode` (_optional_): **Parenting strategy** for the span (**recommended**; replaces legacy `createNewSpan`):
  - `"reuse"` (default): Reuse the current active span if present; otherwise create a new one.
  - `"createChild"`: Always create a new span (child if a parent is active; otherwise root).
  - `"newTrace"`: Always create a new **root** span (new trace).
  - `"newTraceWithLink"`: Create a new **root** span and link it to the current active span (if any).
- `createNewSpan` (**deprecated**): Legacy flag equivalent to `startMode: "createChild"`.

#### Example

```ts
import { Traces } from '@brokerize/telemetry';

class ExampleService {
  @Traces.trace({
    spanName: 'fetch-users',
    attributes: { endpoint: '/api/users' },
    dynamicAttributes: (args) => ({ userId: args[0], method: args[1] }),
    traceOnlyIf: (args) => args[1] === 'GET',
    startMode: 'reuse',
  })
  async fetchUsers(userId: string, method: string) {
    // Implementation
    return { id: userId, status: 'success' };
  }
}
```

- A span named `fetch-users` is created (or reused).
- Static and dynamic attributes are attached.
- Tracing only happens when `method === "GET"`.
- Status is set to `SpanStatusCode.OK` or `SpanStatusCode.ERROR` based on the outcome.
- The span ends automatically.

**Notes**

- Works with both sync and async methods. Errors are recorded and status is set accordingly.
- Parent/child behavior is driven by `startMode` and the **active context**.

---

### Manual Usage

For granular control, use the `Traces` helpers directly.

#### Key Methods (Recommended)

| Method                                                                                      | Description                                                                                     |
|---------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------|
| `getSpan(spanName, options, startMode?, moduleName?)`                                       | Start or reuse a span according to `startMode`. Returns `{ span, createdSpan }`.               |
| `getCurrentSpan()`                                                                          | Returns the current active span, if any.                                                        |
| `setAttribute(key, value)` / `setAttributes(obj)`                                           | Add attributes to the current span.                                                             |
| `setStatus(status)`                                                                          | Set status (`SpanStatusCode.OK` / `SpanStatusCode.ERROR`, etc.).                                |
| `recordException(error)`                                                                     | Record an exception on the current span.                                                        |
| `addEvent(name, attributes?)`                                                                | Add a named event with optional attributes.                                                     |
| `withTracing(fn, options)`                                                                   | Wrap a function; manages context, status, error handling, and span end.                         |

> **Deprecated helper:** `getCurrentSpanOrCreateNew(spanName, options?, createNewSpan?, moduleName?)` is still supported for now, but **use `getSpan(..., startMode, ...)`** going forward.

#### Example with `getSpan`

```ts
import { Traces, SpanStatusCode } from '@brokerize/telemetry';

async function processRequest(userId: string) {
  const { span, createdSpan } = Traces.getSpan(
    'process-request',
    { attributes: { userId } },
    'createChild', // startMode
    'app'          // moduleName (optional)
  );

  try {
    Traces.setAttribute('endpoint', '/api/process');
    // Implementation
    Traces.setStatus({ code: SpanStatusCode.OK });
    return { status: 'success' };
  } catch (error: any) {
    Traces.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    Traces.recordException(error);
    throw error;
  } finally {
    if (createdSpan) span.end();
  }
}
```

#### Example with `withTracing`

```ts
import { Traces } from '@brokerize/telemetry';

const processData = Traces.withTracing(
  async (data: string) => {
    // Implementation
    return { result: data.toUpperCase() };
  },
  {
    spanName: 'process-data',
    attributes: { operation: 'uppercase' },
    dynamicAttributes: (args) => ({ inputLength: args[0].length }),
    startMode: 'createChild',
  }
);

async function main() {
  const result = await processData('hello');
  console.log(result); // { result: 'HELLO' }
}
```

**`withTracing` behavior (sync vs. async)**

- **Natural behavior (default)**: Synchronous functions remain synchronous; asynchronous functions return a Promise.
- **Legacy behavior (opt‑in)**: Force all wrapped calls to return a Promise (see below).

You can control this globally via `tracingMode` / `TRACES_MODE`.

---

## Initialization

Use `initInstrumentation` to set up OpenTelemetry, exporters/processors, and behavior flags.

```ts
/* instrumentation.ts */
import { initInstrumentation } from '@brokerize/telemetry';
import { AmqplibInstrumentation } from '@opentelemetry/instrumentation-amqplib';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';

initInstrumentation({
  serviceName: 'my-service',
  instrumentations: [
    new HttpInstrumentation(),
    new ExpressInstrumentation(),
    new AmqplibInstrumentation({ useLinksForConsume: true }),
  ],
  // Select global wrapper behavior:
  tracingMode: 'natural-sync-async', // or 'legacy-always-promise' (deprecated)
  // Optionally set explicit span limits (also enables limits if not enabled via env):
  // spanLimits: { attributeValueLengthLimit: 12000, attributeCountLimit: 128, ... },

  // ── Exporter/Processor configuration ────────────────────────────────────────
  // EITHER: a simple exporter descriptor (library attaches a BatchSpanProcessor automatically)
  exporter: { kind: 'otlp', url: 'http://your-otel-collector:4318/v1/traces' },
  // exporter: { kind: 'console' } // for local debugging
  // exporter: { kind: 'noop' }    // no-op exporting

  // OR: full control via explicit processors (library will NOT add processors for you)
  // spanProcessors: [
  //   new BatchSpanProcessor(new OTLPTraceExporter({ url: 'http://your-otel-collector:4318/v1/traces' })),
  // ],
});
```

Run with Node’s `--import` if you prefer a separate bootstrap file:

```bash
node --import /usr/src/api/dist/src/instrumentation.js /usr/src/api/dist/src/index.js
```

### Exporter & Processor Precedence

1. **You provide `spanProcessors`** → used **as-is** (no implicit defaults added).
2. **Else if you provide `exporter`** (or legacy `url`/`localDebugging`) → a default **`BatchSpanProcessor(exporter)`** is attached (except for `noop`).
3. **Else** → tracing runs with **no exporter** (no-op).

> **Deprecated legacy flags:** `url`, `localDebugging`, `concurrencyLimit`. Prefer `exporter: { kind: 'otlp' | 'console' | 'noop' }` or pass a concrete `SpanExporter` instance.

### Feature Flags & Environment Variables

- `TRACES_MODE`:
  - `natural-sync-async` (**default**): Sync stays sync; async returns Promise.
  - `legacy-always-promise` (**deprecated**): All wrapped calls return Promises.
- `TRACES_LEGACY_ASYNC_WRAPPER=1`: Shortcut to enable legacy behavior.
- `TRACES_ENABLE_LIMITS=1`: Enable **span limits** (see below).

A one‑time warning is logged when:
- Legacy mode is active.
- Span limits are **disabled** (to encourage adoption).

---

## Span Limits (Opt‑in)

Span limits prevent unbounded memory usage by constraining attribute sizes/counts, events, and links.

- **Disabled by default** to avoid unexpected behavior changes.
- Enable via **env** `TRACES_ENABLE_LIMITS=1` or by passing **`spanLimits`** to `initInstrumentation` (this also enables limits).

**Defaults applied when enabled** (if you don’t override them):

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

Example:

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

---

## Best Practices

1. **Meaningful Span Names**  
   Use clear names like `fetch-users` or `process-request` rather than `operation`.

2. **Relevant, Low‑Cardinality Attributes**  
   Add contextual keys (`endpoint`, `method`, `region`, etc.) and avoid high‑cardinality values when possible.

3. **Hierarchy Matters**  
   Reflect sub‑operations with child spans; control parenting via `startMode` (e.g., `createChild`).

4. **Error Handling**  
   Use `recordException` and `setStatus` for failures; always end spans (the decorator does it for you).

5. **Sampling & Volume Control**  
   Use your collector/sampler to manage data volume; keep attribute sets bounded.

6. **Consistency**  
   Apply consistent naming conventions for spans and attributes (e.g., `snake_case`).

---

## Common Pitfalls

| Pitfall                               | Solution                                                                                  |
|---------------------------------------|-------------------------------------------------------------------------------------------|
| Too many spans                        | Only create spans where they add value.                                                   |
| High attribute cardinality            | Prefer bounded value sets; avoid unique IDs and timestamps unless necessary.              |
| Missing span termination              | End spans in `finally` blocks or use the decorator.                                       |
| Ambiguous span names                  | Use descriptive names reflecting the operation’s purpose.                                 |
| Missing error logging                 | Use `recordException` + `setStatus` on failures.                                          |
| Relying on legacy wrapper semantics   | Prefer `natural-sync-async`; use legacy mode only for temporary migration.                |

---

## Compatibility & Deprecations

- **Use `startMode`** instead of `createNewSpan` (deprecated and will be removed in a future version).
- **Use `getSpan(...)`** instead of `getCurrentSpanOrCreateNew(...)` (deprecated and will be removed in a future version).
- **Legacy wrapper mode** (`legacy-always-promise`) is deprecated. Prefer the default `natural-sync-async` mode.

---

## Backends & Exporters

`@brokerize/telemetry` works with OpenTelemetry‑compatible backends such as Jaeger or Zipkin. Configure an exporter (e.g., OTLP/HTTP) and point it at your collector.

For more details, see the OpenTelemetry docs: https://opentelemetry.io/docs/