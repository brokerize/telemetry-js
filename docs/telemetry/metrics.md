# Metrics

This documentation explains how metrics can be used within the project.

## Overview

Metrics represent numerical values (data) at a specific point in time. They are enriched with a name for identification, tags for description, and key-value pairs (labels) for additional context.

### Metric Types

Two types of metrics are distinguished:

**Resource Metrics** quantify the usage and availability of system resources such as CPU, memory, network, and storage I/O. They indicate whether the underlying infrastructure can handle the load of the applications running on it.

**Service Metrics** provide insights into the performance and reliability of applications, particularly from the perspective of business logic. Examples include the number of database transactions performed, the average response time to user requests, or the ratio of successful to failed requests.

### Metric Types

| Metric Type   | Main Purpose                            | Aggregatable | Example Application                       |
| ------------- | --------------------------------------- | ------------ | ----------------------------------------- |
| **Counter**   | Count events                            | Yes          | Number of HTTP requests                   |
| **Gauge**     | Monitor states or current values        | Yes          | CPU usage or number of active users       |
| **Histogram** | Analyze distributions                   | Yes          | Response times or network latencies       |
| **Summary**   | Calculate precise percentiles           | No           | 99th percentile of response times         |

---

#### Counter...

... are metrics that can only be incremented. They are used to count the number of events that occur during a specific period. Examples include the number of requests, errors, or users who logged in during a specific period.

##### When to use?

- When the metric **only increases** and never decreases.
- To count events that occur over time.
- Ideal for:
    - Number of HTTP requests
    - Number of errors (e.g., 4xx or 5xx status codes)
    - Number of user registrations

---

#### Gauge...

... are metrics that represent a specific value at a specific point in time. They are used to monitor the current state of a system. Examples include CPU usage, memory consumption, or the number of active users.

##### When to use?

- When the value can **both increase and decrease**.
- To monitor the current state or measurement of a system.
- Ideal for:
    - CPU or memory usage
    - Number of active users
    - Temperature values or other sensory measurements

---

#### Histogram...

... are metrics that divide values into predefined intervals (buckets) and count the frequency of values in each bucket. They are used to represent the distribution of response times, request sizes, or other numerical values, with aggregation across multiple instances possible.

##### When to use?

- When the **distribution of values** needs to be analyzed.
- To capture the frequency of measurements in predefined ranges (buckets).
- Particularly suitable when the distribution needs to be aggregated across multiple instances.
- Ideal for:
    - Response times of HTTP requests
    - Sizes of database queries
    - Network latencies

---

#### Summary...

... are metrics that directly calculate percentiles (e.g., 50th, 90th, or 99th percentile) to provide precise values for response times, request sizes, or other numerical data. They are not aggregatable across multiple instances but offer precise insights into the distribution at a local level. Summaries should only be used when precise values (e.g., seconds for a request or data volume in MB for an upload) are not required, but rather the number of requests within a specific range during a period is of interest. Typically, a histogram is used to analyze the distribution of values.

##### When to use?

- When **precise percentiles** for metrics are needed.
- To gain precise insights into the distribution of values at a local level.
- Not suitable when aggregation across multiple instances is required.
- Ideal for:
    - 99th percentile response time of API requests
    - Data volumes for uploads or downloads
    - Response times of individual services

### Metric Names

The naming of metrics is crucial to make the data easily understandable, consistent, and searchable. A clear structure and a uniform naming scheme facilitate the interpretation and maintenance of monitoring systems.

---

#### **General Rules**

1. **Clarity**: Metric names should be self-explanatory so that their meaning is immediately clear.
2. **Consistency**: Use a uniform schema to avoid confusion.
3. **Hierarchical Structure**: Use dots or underscores (`.` or `_`) for organization.
4. **Avoid Abbreviations**: Do not use cryptic abbreviations unless they are widely known.
5. **Uniform Naming Convention**:
    - **snake_case**: Preferred in systems like Prometheus.
    - **dot.notation**: Common in tools like Graphite or Elasticsearch.
6. **Plural vs. Singular**:
    - Singular for values: `http_request_duration`
    - Plural for counts: `http_requests_total`

---

#### **Recommended Structure**

`<namespace>_<subsystem>_<metric>_<unit>`

| Element       | Meaning                                  | Example                         |
| ------------- | ---------------------------------------- | ------------------------------- |
| **Namespace** | The overarching context or service       | `http`, `db`, `app`, `cache`    |
| **Subsystem** | The part of the system being monitored   | `server`, `query`, `user`       |
| **Metric**    | The specific metric being measured       | `requests`, `duration`, `errors`|
| **Unit**      | (Optional) The unit of measurement, if applicable | `seconds`, `bytes`, `total` |

---

#### **Examples**

| Metric Name                        | Meaning                                           |
| ---------------------------------- | ------------------------------------------------- |
| `http_requests_total`              | Total number of HTTP requests                     |
| `http_request_duration_seconds`    | Duration of HTTP requests in seconds              |
| `db_query_execution_time_seconds`  | Duration of database query execution in seconds   |
| `cache_hits_total`                 | Total number of successful cache hits             |
| `app_user_active_sessions`         | Number of active user sessions                    |
| `disk_usage_bytes`                 | Storage consumption in bytes                      |

---

#### **Common Prefixes**

##### **Namespace**

- `http_` for HTTP-related metrics
- `db_` for databases
- `cache_` for cache systems
- `os_` for operating system metrics

##### **Metric Type**

- `_total` for counters (e.g., `http_requests_total`)
- `_current` for gauges (e.g., `app_sessions_current`)
- `_duration` for time measurements (e.g., `http_request_duration_seconds`)
- `_size` or `_usage` for storage (e.g., `disk_usage_bytes`)
- `_ratio` for ratios (e.g., `error_ratio`)

---

#### **Best Practices for Metric Names**

1. **Ensure Uniqueness**:
    - Each name should be unique to avoid confusion.
2. **Avoid Redundant Information**:
    - Do not add unnecessary details that can be covered by labels.
    - Example: `http_requests_total` instead of `http_requests_total_for_all_endpoints`.
3. **Use Labels, Not Names**:
    - Additional information (e.g., endpoint or status code) should be added as [labels](#metric-labels).
    - Correct: `http_requests_total{method="GET", status="200"}`
    - Incorrect: `http_requests_GET_200_total`
4. **Uniform Units**:
    - Specify the unit explicitly in the name (e.g., `seconds`, `bytes`).

---

#### **Common Mistakes and How to Avoid Them**

| Mistake                       | Solution                                            |
| ----------------------------- | --------------------------------------------------- |
| **Overly Generic Names**      | Add a precise namespace or subsystem.               |
| `duration`                    | → `http_request_duration_seconds`                   |
| **Abbreviations or Jargon**   | Write terms out fully.                              |
| `db_qry_exec`                 | → `db_query_execution_time_seconds`                 |
| **Redundancy Through Labels** | Use labels instead of overloaded names.             |
| `http_requests_GET_200_total` | → `http_requests_total{method="GET", status="200"}` |

---

### Metric Labels

Metric labels are key-value pairs that enrich metrics with additional information to categorize, filter, and aggregate data. They provide context and flexibility to analyze and visualize metrics across different dimensions.

---

#### **Best Practices for Labels**

1. **Choose Relevant Dimensions**:
    - Labels should provide useful information to better analyze metrics.
    - Example: `method="GET"`, `status="200"`, `endpoint="/api/v1/resource"`

2. **Standardize Labels**:
    - Maintain consistent naming of labels across all metrics.
    - Example: Always use `status` for HTTP status codes, not `code` or `status_code` interchangeably.

3. **Ensure Unique Combinations**:
    - Each combination of metric name and label values should be unique to avoid duplicate entries.

4. **Use Labels Sparingly**:
    - Avoid unnecessary labels, as they can exponentially increase the number of time series (cardinality problem).
    - Example: Avoid labels like `user_id="12345"` or dynamically generated values.

5. **Data in Labels, Not in Metric Names**:
    - Additional information should be specified as labels, not in the metric name.
    - Correct: `http_requests_total{method="GET", status="200"}`
    - Incorrect: `http_requests_GET_200_total`

---

#### **Examples of Meaningful Labels**

| Label        | Description                              | Example Value           |
| ------------ | ---------------------------------------- | ----------------------- |
| **method**   | HTTP method                              | `GET`, `POST`           |
| **status**   | HTTP status code                         | `200`, `404`            |
| **endpoint** | API endpoint or URL path                 | `/api/v1/resource`      |
| **region**   | Region or location of the system         | `us-west`, `eu-central` |
| **instance** | Instance name or hostname                | `web-server-1`          |
| **job**      | Name of the monitored job                | `api-server`            |
| **type**     | Type of monitored system or object       | `cache`, `db`           |

---

#### **Common Mistakes with Labels**

| Mistake                        | Solution                                                                    |
| ------------------------------ | --------------------------------------------------------------------------- |
| **Too Many Dynamic Values**    | Avoid labels with high variability, like `user_id`.                         |
| **Duplicate Information**      | Do not include the same information in labels and names.                    |
| **Inconsistent Naming**        | Use consistent names like `status` instead of mixing `status_code`.         |
| **Too Many Labels per Metric** | Use only the most important dimensions to keep data manageable.             |

---

#### **Strategy for Choosing Labels**

1. **Add Context-Related Data**:
    - Use labels to categorize data meaningfully.
    - Example: `http_requests_total{method="GET", status="404", region="us-west"}`

2. **Use Labels for Comparability**:
    - Enable comparisons across different dimensions, e.g., regions or instances.

3. **Ensure Coverage**:
    - Ensure labels cover all relevant dimensions but no more.

4. **Plan for Aggregation**:
    - Use labels that allow meaningful aggregation, such as grouping by regions or status codes.

---

## Technical Implementation

Below is the documentation for implementing metrics.

## Using Modules

All used modules are easily available via `import`:

```typescript
import { Metrics } from '@brokerize/telemetry';
import { metrics } from '@brokerize/telemetry';
import { httpMetricsMiddleWare } from '@brokerize/telemetry';
```

- `metrics` - Wrapper to use, create, and manage metrics. This class also provides the export of metrics with the `metrics.getMetrics()` method.
- `httpMetricsMiddleWare` - Middleware that creates and manages metrics for HTTP requests. This middleware can be used in Express.js or other HTTP servers to automatically capture metrics for incoming requests.
- `Metrics` - The `Metrics` class, which creates and manages metrics and provides annotations for easily creating metrics. This class offers a simple way to create and use metrics without manually registering them.

### Usage via Annotations

#### Creating Metrics

When a metric is used via an annotation instead of manually, the metric is automatically created if it does not yet exist.

**Note: The metric is only created when the method containing the annotation is called. The metric is registered with the labels defined in the annotation. If a metric is used in multiple methods with different label names (e.g., one method uses `method` and another adds `status`), the metric should be registered manually with all labels beforehand to avoid incorrect creation (e.g., if the method without the `status` label is called first).**

To create a metric using an annotation, the `@Metrics` annotation from the `Metrics` class is used.

The annotation is placed above the method within a class (TypeScript currently supports annotations only within classes).

The annotation supports the following variants:

- `counter` - Creates a counter
- `gauge` - Creates a gauge
- `histogram` - Creates a histogram
- `summary` - Creates a summary

#### Schema of an Annotation:

`@Metrics.<counter|gauge|histogram|summary>(metricsDecoratorOptions)`

The `metricsDecoratorOptions` contain the following attributes:

- `metricName` - The name of the metric
- `help` - A description of the metric
- `labels` - _Optional_ - The labels of the metric as key-value pairs (e.g., `{ method: 'GET', status: '200' }`)
- `dynamicLabels` - _Optional_ - If labels should be dynamically created based on the method's parameters, they can be defined here and populated as follows:

    ```typescript
    import { Metrics } from '@brokerize/telemetry';

    @Metrics.counter({
        metricName: 'demo_metric',
        help: 'A demo metric',
        dynamicLabels: (args) => ({
            demo: args[0].isDemo ? 'demo' : 'non-demo',
            path: args[1],
            hasBody: args[2].body ? 'yes' : 'no',
            bodySize: args[2].body ? args[2].body.length : 0
        })
    })
    public void exampleMethod(isDemo: boolean, path: string, body: Body) {
        // Method implementation
    }
    ```

Additionally, for histograms and summaries, `buckets` or `percentiles` can be defined:

```typescript
@Metrics.histogram({
    metricName: 'demo_histogram',
    help: 'A demo histogram',
    labels: { method: 'GET' },
    buckets: [0.1, 0.5, 1, 2, 5]
})
public void exampleMethod() {
    // Method implementation
}

@Metrics.summary({
    metricName: 'db_query_duration_seconds',
    help: 'Duration of database queries in seconds',
    labels: { query: 'SELECT * FROM users' },
    percentiles: [0.5, 0.9, 0.99]
})
public void exampleMethod2() {
    // Method implementation
}
```

---

### Manual Usage

To use a new metric, a new metric can be registered using the `metrics` wrapper. The `createMetric` method is used to register the metric. All labels that the metric will use must be defined during registration. Only the `name` and `help` description are mandatory. Optionally, `labels`, `buckets`, and `percentiles` can also be defined.

**Registering a new metric does not yet create it; it only makes it available!**

The metric is only created when it is assigned a value for the first time. This typically happens in the respective modules that use the metrics.

#### Collector Functions

Metrics, such as a gauge, offer the option to define a collector function during registration. If such a function is defined, it is called when the metric values are retrieved, and the metric's value is updated accordingly. In this case, the metric is not set manually but is automatically updated. This also causes the metric to be created immediately upon registration.

To learn more about collector functions, see [here](https://github.com/siimon/prom-client).

##### Example

```typescript
import { metrics, MetricType } from '@brokerize/telemetry';

metrics.createMetric(MetricType.Counter, {
    name: 'brokerize_requests',
    help: 'The number of requests',
    labelNames: ['status', 'method']
});
metrics.createMetric(MetricType.Gauge, {
    metricName: 'cpu_usage',
    help: 'CPU usage in percent',
    labels: ['region']
});
// with collector function
metrics.createMetric(MetricType.Gauge, {
    metricName: 'memory_usage',
    help: 'Memory usage in percent',
    collect: () => {
        return Math.random() * 100;
    }
});
metrics.createMetric(MetricType.Histogram, {
    name: 'job_queue_duration_seconds',
    help: 'The time it takes to process a job',
    labelNames: ['jobtype', 'isShallow'],
    buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]
});
metrics.createMetric(MetricType.Summary, {
    metricName: 'db_query_duration_seconds',
    help: 'Duration of database queries in seconds',
    labels: ['query'],
    percentiles: [0.5, 0.9, 0.99]
});
```

#### Using a Registered Metric

To use a registered metric, the `incrementCounter`, `setGauge`, `observeHistogram`, or `observeSummary` method is used to assign a value to the metric.

**Note: To avoid errors, do not use the methods of the `Metrics` class directly; use the methods from `metrics`.**

#### Schema of Manual Usage:

`metrics.<incrementCounter|setGauge|observeHistogram|observeSummary>(metricName, value, labels)`

##### Example

```typescript
import { metrics } from '@brokerize/telemetry';

metrics.incrementCounter('http_requests_total', { method: 'GET', status: '200' });
metrics.setGauge('cpu_usage', 0.75, { region: 'us-west' });
metrics.observeHistogram('http_request_duration_seconds', 0.5, { method: 'POST' });
metrics.observeSummary('db_query_duration_seconds', 0.1, { query: 'SELECT * FROM users' });
```