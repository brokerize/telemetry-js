import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',

        coverage: {
            provider: 'v8',
            reportsDirectory: './coverage',
            reporter: ['text', 'html', 'lcov', 'json-summary'],
            all: true,
            include: ['src/**/*.ts'],
            exclude: ['dist/**', 'src/**/*.d.ts', '**/*.test.ts', 'test/**', '**/__mocks__/**']
        },
        projects: [
            {
                test: {
                    name: 'tracing',
                    setupFiles: ['./test/tracing/setup-otel.ts'],
                    include: ['test/tracing/**/*.int.test.ts', 'test/tracing/**/*.test.ts'],
                    exclude: ['test/tracing/instrumentation*.test.ts']
                }
            },

            {
                test: {
                    name: 'metrics',
                    include: ['test/metrics/**/*.int.test.ts', 'test/metrics/**/*.test.ts']
                }
            },

            {
                test: {
                    name: 'init instrumentation',
                    environment: 'node',
                    pool: 'forks',
                    include: ['test/tracing/instrumentation.test.ts']
                }
            },
            {
                test: {
                    name: 'utils',
                    include: ['test/utils/**/*.test.ts']
                }
            }
        ]
    }
});
