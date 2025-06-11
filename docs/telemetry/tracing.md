# Tracing

This documentation describes how tracing is used within the project to track application workflows and analyze performance and errors.

## Overview

Tracing enables the tracking of requests and processes in a system by creating so-called **spans**. A span represents a single operation or work step within a process, such as an HTTP request, a database query, or a function. Spans are hierarchically organized to represent relationships between different operations and include metadata such as timestamps, attributes, and error information. Tracing is based on the OpenTelemetry library, which provides a standardized way to monitor distributed systems.

### Main Goals of Tracing

- **Traceability**: Tracking the flow of requests through various components of a system.
- **Performance Analysis**: Identifying bottlenecks and latency issues in applications.
- **Error Diagnosis**: Capturing and analyzing errors to identify their causes.
- **Context Tracking**: Linking operations across multiple services using trace IDs.

---

## Technical Implementation

Tracing is implemented using the `Traces` class, which provides functions for creating, managing, and annotating spans. The class uses the OpenTelemetry API to create spans, add attributes, set statuses, and log errors or events.

---

## Using Tracing

Tracing can be implemented either **manually** by directly using the `Traces` class or **automatically** by using the `@Trace` annotation.

### Usage via Annotations

The `@Trace` annotation provides a simple way to automatically instrument methods with tracing. It creates or uses a span for the annotated method and automatically adds attributes, status, and error information. The annotation is particularly useful for integrating tracing into existing code without manual span management.

#### Schema of an Annotation

```typescript
@Traces.trace(options)
```

The `options` include the following attributes:

- `spanName` (_optional_): The name of the span. By default, the method name is used.
- `attributes` (_optional_): Static key-value pairs added to the span as metadata (e.g., `{ endpoint: "/api/users" }`).
- `dynamicAttributes` (_optional_): A function that returns dynamic attributes based on the method parameters.
- `moduleName` (_optional_): The name of the module for the tracer. By default, the filename of the calling module is used.
- `createNewSpan` (_optional_): If `true`, a new span is always created instead of using an existing one. The default is `false`.

#### Example of an Annotation

```typescript
import { Traces } from '@brokerize/telemetry';

class ExampleService {
    @Traces.trace({
        spanName: 'fetch-users',
        attributes: { endpoint: '/api/users' },
        dynamicAttributes: (args) => ({
            userId: args[0],
            method: args[1]
        })
    })
    async fetchUsers(userId: string, method: string) {
        // Implementation
        return { id: userId, status: 'success' };
    }
}
```

In this example:

- A span named `fetch-users` is created.
- Static attributes `{ endpoint: "/api/users" }` are added.
- Dynamic attributes like `{ userId: "123", method: "GET" }` are added based on the method parameters.
- The span is automatically ended when the method completes, and the status is set to `SpanStatusCode.OK` or `SpanStatusCode.ERROR` depending on the outcome.

#### Notes

- **Asynchronous Methods**: The annotation supports both synchronous and asynchronous methods (Promises). Errors in asynchronous methods are automatically captured and logged as `SpanStatusCode.ERROR`.
- **Span Hierarchy**: If a span is created in a context with an existing span, it is created as a child span of the current span unless `createNewSpan` is `true`.
- **Limitation**: Annotations are only supported in classes, as TypeScript currently does not allow function decorators outside of classes.

---

### Manual Usage

For scenarios requiring more control over tracing, the `Traces` class can be used directly. This allows manual creation, management, and termination of spans, as well as adding attributes, status, and events.

#### Key Methods of the `Traces` Class

| Method                                                                   | Description                                                                        |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `getCurrentSpanOrCreateNew(spanName, options, createNewSpan, moduleName)` | Returns the current span or creates a new one.                                      |
| `getCurrentSpan()`                                                        | Returns the current active span, if available.                                      |
| `setAttribute(key, value)`                                                | Adds a single attribute to the current span.                                        |
| `setAttributes(attributes)`                                               | Adds multiple attributes to the current span.                                       |
| `setStatus(status)`                                                       | Sets the status of the span (e.g., `SpanStatusCode.OK` or `SpanStatusCode.ERROR`). |
| `recordException(error)`                                                  | Logs an exception in the current span.                                             |
| `addEvent(name, attributes)`                                              | Adds an event with optional attributes to the current span.                         |
| `withTracing(fn, options)`                                                | Wraps a function in a span and handles status, errors, and termination.             |

#### Example of Manual Usage

```typescript
import { Traces, SpanStatusCode } from '@brokerize/telemetry';

async function processRequest(userId: string) {
    const { span, createdSpan } = Traces.getCurrentSpanOrCreateNew('process-request', {
        attributes: { userId }
    });

    try {
        Traces.setAttribute('endpoint', '/api/process');
        // Implementation
        Traces.setStatus({ code: SpanStatusCode.OK });
        return { status: 'success' };
    } catch (error) {
        Traces.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        Traces.recordException(error);
        throw error;
    } finally {
        if (createdSpan) {
            span.end();
        }
    }
}
```

In this example:

- A new span named `process-request` is created.
- Attributes like `userId` and `endpoint` are added.
- The status is set based on the success or failure of the operation.
- The span is manually ended if it was newly created.

#### Example with `withTracing`

```typescript
import { Traces } from '@brokerize/telemetry';

const processData = Traces.withTracing(
    async (data: string) => {
        // Implementation
        return { result: data.toUpperCase() };
    },
    {
        spanName: 'process-data',
        attributes: { operation: 'uppercase' },
        dynamicAttributes: (args) => ({ inputLength: args[0].length })
    }
);

async function main() {
    const result = await processData('hello');
    console.log(result); // { result: 'HELLO' }
}
```

In this example:

- The `processData` function is wrapped with a span.
- The span receives static (`operation`) and dynamic (`inputLength`) attributes.
- Errors and status are automatically handled, and the span is ended upon completion.

---

## Best Practices for Tracing

1. **Meaningful Span Names**:

    - Use clear, descriptive names like `fetch-users` or `process-request` instead of generic names like `operation`.
    - Example: `db_query_select_users` instead of `query`.

2. **Relevant Attributes**:

    - Add attributes that describe the operation's context, such as `endpoint`, `method`, `userId`, or `region`.
    - Avoid unnecessary or highly variable dynamically generated attributes (e.g., timestamps or unique IDs) to reduce cardinality.

3. **Hierarchical Structure**:

    - Leverage the hierarchical nature of spans to represent relationships between operations. Create child spans for sub-operations, e.g., a database query within an HTTP request.
    - Set `createNewSpan: false` (default) to use existing spans unless a new context is required.

4. **Error Handling**:

    - Log errors with `recordException` to capture detailed information like stack traces.
    - Set the span status to `SpanStatusCode.ERROR` for errors to mark the cause.

5. **Performance Optimization**:

    - Avoid creating unnecessary spans for trivial operations to minimize overhead.
    - Use sampling rules (e.g., `otel.collector.sampling.keep`) to control the amount of collected data.

6. **Consistency**:
    - Use consistent naming conventions for spans and attributes, e.g., `snake_case` for span names and attributes.
    - Example: `http_request_duration` instead of `HTTPRequestDuration`.

---

## Common Mistakes and How to Avoid Them

| Mistake                              | Solution                                                                                 |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| **Too Many Spans**                   | Create spans only for relevant operations to avoid overhead.                             |
| **High Cardinality from Attributes** | Avoid attributes with dynamic values like `user_id` or timestamps.                      |
| **Missing Span Termination**         | Ensure spans are ended in `finally` blocks or through annotations.                      |
| **Unclear Span Names**               | Use descriptive names that reflect the operation's purpose.                             |
| **Missing Error Logging**            | Use `recordException` and `setStatus` for all error cases.                              |

---

## Integration with OpenTelemetry

The `Traces` class is based on the OpenTelemetry API and is compatible with OpenTelemetry-compliant backends such as Jaeger, Zipkin, or Prometheus. To export tracing data, an OpenTelemetry exporter must be configured. For more information on configuration, refer to the [OpenTelemetry documentation](https://opentelemetry.io/docs/).

This package provides the `initInstrumentation` method to automatically initialize and configure the OpenTelemetry exporter.

### Initializing Instrumentation

```typescript
/*instrumentation.ts*/
import { initInstrumentation } from '@brokerize/telemetry';
import { AmqplibInstrumentation } from '@opentelemetry/instrumentation-amqplib';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';

initInstrumentation({
    serviceName: 'my-service',
    url: 'http://your-otel-collector:4318/v1/traces',
    localDebugging: false,
    concurrencyLimit: 10,
    instrumentations: [
        new HttpInstrumentation(),
        new ExpressInstrumentation(),
        new AmqplibInstrumentation({
            useLinksForConsume: true
        })
    ]
});
```

The `initInstrumentation` function initializes the OpenTelemetry instrumentation and configures the exporter for tracing data. The parameters are:

- `serviceName`: The name of the service displayed in tracing.
- `url`: The URL of the OpenTelemetry Collector to which tracing data is sent.
- `localDebugging`: Optional, if `true`, tracing data is stored locally and not sent to the collector. Useful for debugging purposes.
- `concurrencyLimit`: Optional, the maximum number of concurrent spans that can be processed. Defaults to 10.
- `instrumentations`: A list of OpenTelemetry instrumentations to be enabled. Various instrumentations such as `HttpInstrumentation`, `ExpressInstrumentation`, or `AmqplibInstrumentation` can be added here.

It is critical to call the `initInstrumentation` function at the start of the application to ensure that all spans are correctly captured and exported.

This can be done, for example, in a separate file like `instrumentation.ts`, which can then be included as follows:

```bash
node --import /usr/src/api/dist/src/instrumentation.js /usr/src/api/dist/src/index.js
```