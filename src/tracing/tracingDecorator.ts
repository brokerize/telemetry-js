// @ts-strict-ignore
import type { Span, SpanContext, SpanOptions } from '@opentelemetry/api';
import { context, SpanStatusCode, trace } from '@opentelemetry/api';

import { getCallerFile } from '../util/util.ts';

export interface TraceDecoratorOptions {
    spanName?: string;
    attributes?: Record<string, any>;
    dynamicAttributes?: (args: any[]) => Record<string, any>;
    moduleName?: string;
    createNewSpan?: boolean;
}

type FunctionToTrace = (...args: any[]) => any;

export class Traces {
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

    static getCurrentSpan(): Span | undefined {
        return trace.getSpan(context.active());
    }

    static setAttributes(attributes: Record<string, any>) {
        const span = this.getCurrentSpan();
        if (span) {
            for (const [key, value] of Object.entries(attributes)) {
                span.setAttribute(key, value);
            }
        }
    }

    static setAttribute(key: string, value: any) {
        const span = this.getCurrentSpan();
        if (span) {
            span.setAttribute(key, value);
        }
    }

    static setStatus(status: { code: SpanStatusCode; message?: string }) {
        const span = this.getCurrentSpan();
        if (span) {
            span.setStatus(status);
        }
    }

    static recordException(error: Error) {
        const span = this.getCurrentSpan();
        if (span) {
            span.recordException(error);
        }
    }

    static addEvent(name: string, attributes?: Record<string, any>) {
        const span = this.getCurrentSpan();
        if (span) {
            span.addEvent(name, attributes);
        }
    }

    private static logSpanHierarchy(span: Span) {
        const spanContext: SpanContext = span.spanContext();
        const parentSpan = this.getCurrentSpan(); // Den aktuellen aktiven Span als Eltern-Span betrachten, falls vorhanden

        if (parentSpan) {
            const parentContext = parentSpan.spanContext();
        }
    }

    static trace = (options: TraceDecoratorOptions = { createNewSpan: false }) => {
        return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
            const originalMethod = descriptor.value;
            const moduleName = options.moduleName || target.constructor.name;

            descriptor.value = function (...args: any[]) {
                const spanName = options.spanName || propertyKey;
                let dynamicLabels: Record<string, any> = {};

                if (!options.attributes) {
                    options.attributes = {};
                }

                if (options.dynamicAttributes) {
                    dynamicLabels = options.dynamicAttributes(args);
                }

                const { span, createdSpan } = Traces.getCurrentSpanOrCreateNew(
                    spanName,
                    {
                        attributes: {
                            ...(options.attributes || {}),
                            ...(dynamicLabels || {})
                        }
                    },
                    options.createNewSpan,
                    moduleName
                );

                let spanEnded = false;

                const endSpan = () => {
                    if (!spanEnded && createdSpan) {
                        span.end();
                        spanEnded = true;
                    }
                };

                try {
                    return context.with(trace.setSpan(context.active(), span), async () => {
                        const result = originalMethod.apply(this, args);

                        if (result instanceof Promise) {
                            try {
                                const res = await result;
                                span.setStatus({ code: SpanStatusCode.OK });
                                return res;
                            } catch (error: any) {
                                span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
                                span.recordException(error);
                                throw error;
                            } finally {
                                endSpan();
                            }
                        } else {
                            span.setStatus({ code: SpanStatusCode.OK });
                            endSpan();
                            return result;
                        }
                    });
                } catch (error: any) {
                    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
                    span.recordException(error);
                    endSpan();
                    throw error;
                }
            };

            return descriptor;
        };
    };

    static withTracing<T extends FunctionToTrace>(fn: T, options: TraceDecoratorOptions = {}): T {
        const {
            spanName = fn.name,
            attributes = {},
            dynamicAttributes,
            createNewSpan = false,
            moduleName = getCallerFile()
        } = options;

        const spanNameFinal = spanName || fn.name;

        return function (...args: Parameters<T>): ReturnType<T> | Promise<ReturnType<T>> {
            const dynamicAttrs = dynamicAttributes ? dynamicAttributes(args) : {};
            const spanOptions = {
                attributes: {
                    ...attributes,
                    ...dynamicAttrs
                }
            };
            if (fn.name !== '') {
                spanOptions.attributes['function.name'] = fn.name;
            }

            // Create a new Span for this function call
            const { span, createdSpan } = Traces.getCurrentSpanOrCreateNew(
                spanNameFinal,
                {
                    attributes: spanOptions.attributes
                },
                createNewSpan,
                moduleName
            );

            let spanEnded = false;

            const endSpan = () => {
                if (!spanEnded && createdSpan) {
                    span.end();
                    spanEnded = true;
                }
            };

            try {
                const result = context.with(trace.setSpan(context.active(), span), async () => fn(...args));
                return result
                    .then((res) => {
                        // Check if the result is another function and trace it
                        span.setStatus({ code: SpanStatusCode.OK });
                        return res;
                    })
                    .catch((error) => {
                        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
                        span.recordException(error);
                        throw error;
                    })
                    .finally(() => {
                        endSpan();
                    });
            } catch (error: any) {
                span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
                span.recordException(error);
                endSpan();
                throw error;
            }
        } as T;
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
