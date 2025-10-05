import { beforeAll, afterAll } from 'vitest';
import { trace, context } from '@opentelemetry/api';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';

export const exporter = new InMemorySpanExporter();

const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)]
});

let cm: AsyncLocalStorageContextManager;

beforeAll(() => {
    trace.setGlobalTracerProvider(provider);
    cm = new AsyncLocalStorageContextManager();
    context.setGlobalContextManager(cm);
});

afterAll(async () => {
    await provider.shutdown();
    exporter.reset();
    cm.disable();
});
