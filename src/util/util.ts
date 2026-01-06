import { createRequire } from 'node:module';

export function getCallerFile() {
    const originalFunc = Error.prepareStackTrace;

    let callerFile: string | undefined;
    try {
        const err = new Error();

        Error.prepareStackTrace = (err, stack) => stack;

        const stack = err.stack as unknown as NodeJS.CallSite[];

        const currentFile = stack.shift()?.getFileName();

        while (stack.length) {
            const fileName = stack.shift()?.getFileName();
            if (fileName !== null && fileName !== undefined) {
                callerFile = fileName;
            }

            if (currentFile !== callerFile) {
                break;
            }
        }
    } catch (e) {
        // ignore
    }

    Error.prepareStackTrace = originalFunc;

    return callerFile || '';
}

const require = createRequire(import.meta.url);

export function getExpressMajor(): number | undefined {
    try {
        const pkg = require('express/package.json') as { version?: string };
        const major = Number(pkg.version?.split('.')[0]);
        return Number.isFinite(major) ? major : undefined;
    } catch {
        return undefined;
    }
}
