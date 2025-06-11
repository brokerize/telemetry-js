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
        // Fallback handling
    }

    Error.prepareStackTrace = originalFunc;

    return callerFile || '';
}
