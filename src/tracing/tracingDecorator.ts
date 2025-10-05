// @ts-strict-ignore
import type { Context, Span, SpanContext, SpanOptions } from '@opentelemetry/api';
import { context, SpanStatusCode, trace } from '@opentelemetry/api';

import { getCallerFile } from '../util/util.ts';

import { getTracingMode } from './tracing-config.ts';

/**
 * Strategy for obtaining a span in relation to the currently active context.
 *
 * - `reuse` – If there is an active span in `context.active()`, **reuse it**
 *   (no new span is created). If `context.active()` is not set, a new span will be created.
 *   Useful when you want to enrich an existing span with attributes/events/status without increasing span cardinality.
 *
 * - `createChild` – **Always create a new span**. If an active span
 *   exists, the new span becomes its **child** (parent is taken from
 *   `context.active()`). If no active span exists, the new span becomes a
 *   **root** span. This is the idiomatic OpenTelemetry default for “make a new
 *   span for this operation.”
 *
 * - `newTrace` – **Always create a new root span** (a brand-new trace). The
 *   active context is ignored for parenting. Use this when you intentionally
 *   want an operation to be tracked as an independent trace (e.g., a detached
 *   background job).
 * - `newTraceWithLink` – **Always create a new root span** (a brand-new trace),
 *   but link it to the current active span, if any. This is useful for batch
 *   processing jobs that are triggered by a request but run independently of
 *   it. The new trace can be linked to the triggering request's span to allow
 *   tracing systems to discover the relationship.
 */
type StartMode = 'reuse' | 'createChild' | 'newTrace' | 'newTraceWithLink';

/**
 * Options for the `@trace` decorator and the `withTracing()` wrapper.
 *
 * @property spanName
 * Human-readable span name. Defaults to the function/method name.
 *
 * @property attributes
 * Static attributes to set on every span created for this function.
 *
 * @property dynamicAttributes
 * Callback that receives the invocation arguments and returns attributes to
 * add to the span. Its return wins on key conflicts with `attributes`.
 *
 * @property moduleName
 * Logical tracer name passed to `trace.getTracer(...)`. Defaults to the caller file.
 *
 * @property startMode
 * Span parenting strategy. See {@link StartMode}. Defaults to `'reuse'`.
 * - `'reuse'`        → reuse the active span if present; otherwise create a new one
 * - `'createChild'`  → always create a new span (child if a parent is active; else root)
 * - `'newTrace'`     → always create a new **root** span (new trace)
 *
 * @property traceOnlyIf
 * Enables conditional tracing. If `false`, no tracing is performed.
 * If a function is provided, it is evaluated at call time and may inspect
 * the invocation arguments and the current active span to decide.
 *
 * @property createNewSpan
 *
 * @remarks
 * - `dynamicAttributes` is evaluated per call; avoid heavy work inside it.
 * @example Basic usage (always child if a parent exists)
 * ```ts
 * class OrderService {
 *   @Traces.trace({
 *     spanName: 'processOrder',
 *     attributes: { service: 'order' },
 *     startMode: 'createChild',
 *     moduleName: 'order-service'
 *   })
 *   async processOrder(orderId: string) { ...  }
 * }
 * ```
 *
 * @example Conditional tracing by flag and arguments
 * ```ts
 * @Traces.trace({
 *   startMode: 'reuse',
 *   traceOnlyIf: (args) => process.env.ENABLE_TRACING === '1'
 * })
 * function computeTotal(cart: Cart) {  ... *}
 * ```
 */
export interface TraceDecoratorOptions {
    /** Human-readable span name. Defaults to the function/method name. */
    spanName?: string;

    /** Static attributes to set on the span. */
    attributes?: Record<string, any>;

    /**
     * Derive per-invocation attributes from call arguments.
     * Returned keys override duplicates from `attributes`.
     */
    dynamicAttributes?: (args: any[]) => Record<string, any>;

    /** Logical tracer name passed to `trace.getTracer(...)`. Defaults to caller file. */
    moduleName?: string;

    /**
     * Span parenting strategy. Defaults to `'reuse'`.
     * - `'reuse'`       → reuse the active span if present; else create new
     * - `'createChild'` → always new span (child if parent active; else root)
     * - `'newTrace'`    → always new **root** span (new trace)
     */
    startMode?: StartMode;

    /**
     * Conditional tracing. If `false`, no tracing. If a function, it is called
     * with the invocation arguments and may inspect them to decide.
     */
    traceOnlyIf?: boolean | ((args: any[], thisContext: any, currentSpan?: Span) => boolean);

    /**
     * @deprecated Use `startMode` instead.
     * If `true`, treated as `startMode: 'createChild'`.
     */
    createNewSpan?: boolean;
}

type FunctionToTrace = (...args: any[]) => any;

export class Traces {
    /**
     * Returns the current active span, or creates and returns a new span if none is active.
     *
     * @param spanName - The name of the span to create if needed.
     * @param options - Standard OpenTelemetry {@link SpanOptions}.
     *   - Note: If a new span is created, `options.root` is ignored and the new span becomes a child
     *     of the current active span, if any.
     * @param createNewSpan - If `true`, always create a new span; if `false`, reuse the current active span if any.
     *   - Note: If `createNewSpan` is `false` and there is no active span, a new span is created.
     * @param moduleName - Logical tracer name (passed to `trace.getTracer`). Defaults to the caller file.
     * @returns An object with `{ span, createdSpan }`, where:
     * - `createdSpan` is `true` if a new span was created, `false` if the current active span was reused.
     * - `span` is the current active span or the newly created span.
     *@deprecated Use {@link Traces.getSpan} with `mode: 'reuse' | 'createChild'` instead.
     */
    static getCurrentSpanOrCreateNew(
        spanName: string,
        options?: SpanOptions,
        createNewSpan = false,
        moduleName = getCallerFile()
    ): { span: Span; createdSpan: boolean } {
        let createdSpan = false;
        let span = trace.getSpan(context.active());
        const optionsWithSamplingRule = this._setSamplingRule(options);
        if (!span || createNewSpan) {
            const tracer = trace.getTracer(moduleName);
            span = tracer.startSpan(spanName, optionsWithSamplingRule);
            createdSpan = true;
        }

        return { span, createdSpan };
    }
    /** Returns the current active span, or `undefined` if none is active.
     */
    static getCurrentSpan(): Span | undefined {
        return trace.getSpan(context.active());
    }

    /**
     * Returns a span according to the requested {@link StartMode}.
     *
     * @param spanName - The name of the span to start or reuse.
     * @param options - Standard OpenTelemetry {@link SpanOptions}.
     *   - Note: When `mode` is `"newTrace"`, the implementation will honor `options.root = true`
     *     (or equivalent) to ensure the span is created as a root/span of a new trace.
     * @param mode - Parenting strategy. See {@link StartMode}. Defaults to `"reuse"`.
     * @param moduleName - Logical tracer name (passed to `trace.getTracer`). Defaults to the caller file.
     * @returns An object with `{ span, createdSpan }`, where:
     * - `createdSpan` is `false` only in `"reuse"` mode when an active span exists and is reused.
     * - Otherwise a new span is created and `createdSpan` is `true`.
     *
     * @remarks
     * - **Child-vs-root behavior:** OpenTelemetry determines parentage from the **active context**.
     *   In `"createChildIfActive"`, a new span is started; if a parent span is active it becomes a child,
     *   otherwise it becomes a root span. In `"newTrace"`, a new root span is started regardless of context.
     * @example
     * // Reuse the current span (no new span created)
     * const { span, createdSpan } = Traces.getSpan('ignored-name', {}, 'reuse', 'orders-service');
     * // createdSpan === false
     *
     * @example
     * // Create a new span (child if a parent is active, else root)
     * const { span } = Traces.getSpan('validate-order', { attributes: { orderId } }, 'createChildIfActive', 'orders-service');
     * // ...do work...
     * span.end();
     *
     * @example
     * // Force a new root span (new trace), ignoring any active parent
     * const { span } = Traces.getSpan('batch-reindex', { ... }, 'newTrace', 'maintenance');
     * // ...do work...
     * span.end();
     */
    static getSpan(
        spanName: string,
        options?: SpanOptions,
        mode: StartMode = 'reuse',
        moduleName = getCallerFile()
    ): { span: Span; createdSpan: boolean } {
        const tracer = trace.getTracer(moduleName);
        const opts = this._setSamplingRule(options);

        if (mode === 'reuse') {
            const active = trace.getSpan(context.active());
            if (active) return { span: active, createdSpan: false };
        }

        if (mode === 'newTrace') {
            const span = tracer.startSpan(spanName, { ...opts, root: true });
            return { span, createdSpan: true };
        }

        if (mode === 'newTraceWithLink') {
            const active = trace.getSpan(context.active());
            if (active) {
                const span = tracer.startSpan(spanName, {
                    ...opts,
                    root: true,
                    links: [{ context: active.spanContext() }]
                });
                return { span, createdSpan: true };
            } else {
                const span = tracer.startSpan(spanName, { ...opts, root: true });
                return { span, createdSpan: true };
            }
        }

        const span = tracer.startSpan(spanName, opts);
        return { span, createdSpan: true };
    }
    /** Sets multiple attributes on the current active span.
     * If no span is active, does nothing.
     *
     * @param attributes - Key-value pairs of attributes to set.
     */
    static setAttributes(attributes: Record<string, any>) {
        const span = this.getCurrentSpan();
        if (span) {
            for (const [key, value] of Object.entries(attributes)) {
                span.setAttribute(key, value);
            }
        }
    }
    /** Sets an attribute on the current active span.
     * If no span is active, does nothing.
     *
     * @param key - Attribute key.
     * @param value - Attribute value.
     */
    static setAttribute(key: string, value: any) {
        const span = this.getCurrentSpan();
        if (span) {
            span.setAttribute(key, value);
        }
    }

    /** Sets the status on the current active span.
     * If no span is active, does nothing.
     *
     * @param status - The status to set on the span.
     */
    static setStatus(status: { code: SpanStatusCode; message?: string }) {
        const span = this.getCurrentSpan();
        if (span) {
            span.setStatus(status);
        }
    }
    /** Records an exception on the current active span.
     * If no span is active, does nothing.
     *
     * @param error - The exception to record.
     */
    static recordException(error: Error) {
        const span = this.getCurrentSpan();
        if (span) {
            span.recordException(error);
        }
    }
    /** Adds an event to the current active span.
     * If no span is active, does nothing.
     *
     * @param name - The name of the event.
     * @param attributes - Optional attributes to add to the event.
     */
    static addEvent(name: string, attributes?: Record<string, any>) {
        const span = this.getCurrentSpan();
        if (span) {
            span.addEvent(name, attributes);
        }
    }

    /** Logs the hierarchy of spans.
     * @param span - The span to log.
     */
    private static logSpanHierarchy(span: Span) {
        const spanContext: SpanContext = span.spanContext();
        const parentSpan = this.getCurrentSpan();

        if (parentSpan) {
            const parentContext = parentSpan.spanContext();
        }
    }
    /** Method decorator that traces the decorated method.
     *
     * @param options - Options for the trace decorator.
     * @returns A method decorator function.
     *
     * @example Basic usage (always child if a parent exists)
     * ```ts
     * class OrderService {
     *   @Traces.trace({
     *     spanName: 'processOrder',
     *     attributes: { service: 'order' },
     *     startMode: 'createChild',
     *     moduleName: 'order-service'
     *   })
     *   async processOrder(orderId: string) { ...  }
     * }
     * ```
     * @example Basic usage with dynamic attributes
     * ```ts
     * class OrderService {
     *  @Traces.trace({
     *   spanName: 'processOrder',
     *  attributes: { service: 'order' },
     *  dynamicAttributes: (args) => ({ orderId: args[0] }),
     * startMode: 'createChild',
     * moduleName: 'order-service'
     * })
     * async processOrder(orderId: string) { ...  }
     * }
     * ```
     * @example Conditional tracing by flag and arguments
     * ```ts
     * @Traces.trace({
     *   startMode: 'reuse',
     *   traceOnlyIf: (args) => process.env.ENABLE_TRACING === '1'
     * })
     * function computeTotal(cart: Cart) {  ... *}
     * ```
     */
    static trace(options: TraceDecoratorOptions = { startMode: 'reuse', traceOnlyIf: true }) {
        const factory: any = (...decoratorArgs: any[]) => {
            if (
                decoratorArgs.length === 2 &&
                typeof decoratorArgs[0] === 'function' &&
                decoratorArgs[1] &&
                typeof decoratorArgs[1] === 'object' &&
                'kind' in decoratorArgs[1]
            ) {
                const value: Function = decoratorArgs[0];
                const ctx: {
                    kind: 'method' | 'getter' | 'setter' | 'field' | 'auto-accessor';
                    name: string | symbol;
                    static?: boolean;
                    private?: boolean;
                    addInitializer?: (init: () => void) => void;
                    access?: {
                        get?: (thisArg: any) => any;
                        set?: (thisArg: any, v: any) => void;
                        has?: (thisArg: any) => boolean;
                    };
                    metadata?: unknown;
                } = decoratorArgs[1];
                if (ctx.kind === 'field') {
                    const inferredName = typeof ctx.name === 'string' ? ctx.name : 'anonymous';
                    const inferredModule = getCallerFile();
                    return function (initialValue: unknown) {
                        if (typeof initialValue !== 'function') return initialValue;
                        const wrapped = Traces._wrapCallableWithTracing(
                            initialValue as any,
                            options,
                            inferredName,
                            inferredModule
                        );
                        return wrapped;
                    };
                }

                if (ctx.kind === 'auto-accessor') {
                    const inferredName = typeof ctx.name === 'string' ? ctx.name : 'anonymous';
                    const inferredModule = getCallerFile();
                    return {
                        init(initialValue: unknown) {
                            if (typeof initialValue !== 'function') return initialValue;
                            const wrapped = Traces._wrapCallableWithTracing(
                                initialValue as any,
                                options,
                                inferredName,
                                inferredModule
                            );
                            return wrapped;
                        }
                    };
                }

                if (ctx.kind === 'method' || ctx.kind === 'getter' || ctx.kind === 'setter') {
                    const inferredName = typeof ctx.name === 'string' ? ctx.name : 'anonymous';
                    const inferredModule = getCallerFile();

                    const wrapped = Traces._wrapCallableWithTracing(
                        value as any,
                        options,
                        inferredName,
                        inferredModule
                    );

                    return wrapped;
                }

                return value;
            }

            if (
                decoratorArgs.length === 3 &&
                typeof decoratorArgs[1] !== 'undefined' &&
                decoratorArgs[2] &&
                typeof decoratorArgs[2] === 'object'
            ) {
                const target = decoratorArgs[0];
                const propertyKey: string | symbol = decoratorArgs[1];
                const descriptor: PropertyDescriptor = decoratorArgs[2];

                if (!descriptor) {
                    throw new Error(
                        `@Traces.trace can only decorate methods/getters/setters with legacy decorators. For class fields, enable the new TC39 decorators or convert to a method.`
                    );
                }

                const originalMethod = descriptor.value ?? descriptor.get ?? descriptor.set;
                if (typeof originalMethod !== 'function') return descriptor;

                const moduleName = options.moduleName || target?.constructor?.name || getCallerFile();
                const spanName = options.spanName || (typeof propertyKey === 'string' ? propertyKey : 'anonymous');

                const wrapped = Traces._wrapCallableWithTracing(originalMethod, options, spanName, moduleName);

                if (descriptor.value) descriptor.value = wrapped;
                else if (descriptor.get) descriptor.get = wrapped;
                else if (descriptor.set) descriptor.set = wrapped;

                return descriptor;
            }

            return decoratorArgs[2];
        };

        return factory;
    }

    private static _wrapCallableWithTracing<T extends (...a: any[]) => any>(
        originalFn: T,
        options: TraceDecoratorOptions,
        inferredSpanName: string,
        inferredModuleName: string
    ): T {
        const {
            spanName = inferredSpanName || originalFn.name || 'anonymous',
            attributes = {},
            dynamicAttributes,
            startMode = options.createNewSpan ? 'createChild' : options.startMode ?? 'reuse',
            traceOnlyIf = true,
            moduleName = inferredModuleName || getCallerFile()
        } = options;

        const globalLegacy = getTracingMode() === 'legacy-always-promise';
        const coerceToPromise = globalLegacy;

        const wrapped = function (this: any, ...args: any[]) {
            const currentSpan = Traces.getCurrentSpan();
            const shouldTrace =
                typeof traceOnlyIf === 'function' ? traceOnlyIf(args, this, currentSpan) : !!traceOnlyIf;

            if (!shouldTrace) {
                const res = originalFn.apply(this, args);
                return coerceToPromise ? Promise.resolve(res) : res;
            }

            const dyn = dynamicAttributes ? dynamicAttributes(args) : {};
            const spanOptions: SpanOptions = {
                attributes: {
                    ...attributes,
                    ...dyn,
                    ...(originalFn.name ? { 'function.name': originalFn.name } : {})
                }
            };

            const { span, createdSpan } = Traces.getSpan(spanName, spanOptions, startMode, moduleName);

            let spanEnded = false;
            const endSpan = () => {
                if (!spanEnded && createdSpan) {
                    span.end();
                    spanEnded = true;
                }
            };

            try {
                const result = context.with(trace.setSpan(context.active(), span), () => {
                    return originalFn.apply(this, args);
                });

                const isThenable = result && typeof (result as any).then === 'function';

                if (isThenable) {
                    return (result as Promise<any>)
                        .then((res) => {
                            span.setStatus({ code: SpanStatusCode.OK });
                            return res;
                        })
                        .catch((error: any) => {
                            span.setStatus({ code: SpanStatusCode.ERROR, message: error?.message });
                            span.recordException(error);
                            throw error;
                        })
                        .finally(() => {
                            endSpan();
                        });
                } else {
                    span.setStatus({ code: SpanStatusCode.OK });
                    endSpan();
                    return coerceToPromise ? Promise.resolve(result) : result;
                }
            } catch (error: any) {
                span.setStatus({ code: SpanStatusCode.ERROR, message: error?.message });
                span.recordException(error);
                endSpan();
                if (coerceToPromise) return Promise.reject(error);
                throw error;
            }
        };

        return wrapped as unknown as T;
    }

    static withTracing<T extends FunctionToTrace>(fn: T, options: TraceDecoratorOptions = {}): T {
        const {
            spanName = fn.name || 'anonymous',
            attributes = {},
            dynamicAttributes,
            startMode = options.createNewSpan ? 'createChild' : options.startMode ?? 'reuse',
            traceOnlyIf = true,
            moduleName = getCallerFile()
        } = options;

        const globalLegacy = getTracingMode() === 'legacy-always-promise';
        const coerceToPromise = globalLegacy;

        const wrapped = function (
            this: ThisParameterType<T>,
            ...args: Parameters<T>
        ): ReturnType<T> | Promise<ReturnType<T>> {
            const currentSpan = Traces.getCurrentSpan();
            const shouldTrace =
                typeof traceOnlyIf === 'function' ? traceOnlyIf(args, this, currentSpan) : !!traceOnlyIf;

            if (!shouldTrace) {
                const res = fn.apply(this, args);
                return coerceToPromise ? Promise.resolve(res) : res;
            }

            const dyn = dynamicAttributes ? dynamicAttributes(args) : {};
            const spanOptions: SpanOptions = {
                attributes: {
                    ...attributes,
                    ...dyn,
                    ...(fn.name ? { 'function.name': fn.name } : {})
                }
            };

            const { span, createdSpan } = Traces.getSpan(spanName, spanOptions, startMode, moduleName);

            let spanEnded = false;
            const endSpan = () => {
                if (!spanEnded && createdSpan) {
                    span.end();
                    spanEnded = true;
                }
            };

            try {
                const result = context.with(trace.setSpan(context.active(), span), () => {
                    return fn.apply(this, args);
                });

                const isThenable = result && typeof (result as any).then === 'function';

                if (isThenable) {
                    // Promise-Fall
                    return (result as Promise<ReturnType<T>>)
                        .then((res) => {
                            span.setStatus({ code: SpanStatusCode.OK });
                            return res;
                        })
                        .catch((error: any) => {
                            span.setStatus({ code: SpanStatusCode.ERROR, message: error?.message });
                            span.recordException(error);
                            throw error;
                        })
                        .finally(() => {
                            endSpan();
                        });
                } else {
                    span.setStatus({ code: SpanStatusCode.OK });
                    endSpan();
                    return coerceToPromise ? Promise.resolve(result as ReturnType<T>) : (result as ReturnType<T>);
                }
            } catch (error: any) {
                span.setStatus({ code: SpanStatusCode.ERROR, message: error?.message });
                span.recordException(error);
                endSpan();
                if (coerceToPromise) return Promise.reject(error);
                throw error;
            }
        };

        return wrapped as unknown as T;
    }

    private static _setSamplingRule(spanOption: SpanOptions | undefined): SpanOptions {
        if (!spanOption) {
            spanOption = { attributes: {} };
        }

        if (!spanOption.attributes) {
            spanOption.attributes = {};
        }

        if (!spanOption.attributes['otel.collector.sampling.keep']) {
            spanOption.attributes['otel.collector.sampling.keep'] = false;
        }

        return spanOption;
    }
}
