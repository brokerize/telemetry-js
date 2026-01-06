import type { Request } from 'express';

interface Layer {
    route?: { path?: string | RegExp | Array<string | RegExp> };
}

type RouterWithStack = { stack: Layer[] };
type AppWithRouters = { router?: RouterWithStack; _router?: RouterWithStack };

function getStack(req: Request): Layer[] {
    const app = req.app as unknown as AppWithRouters;
    const stack = app.router?.stack ?? app._router?.stack;
    return Array.isArray(stack) ? stack : [];
}

function matchesLayerPath(layer: Layer, pathname: string): boolean {
    const p = layer.route?.path;
    if (!p) return false;

    const matchOne = (x: string | RegExp) => {
        if (x instanceof RegExp) return x.test(pathname);
        const routeRegex = new RegExp('^' + x.replace(/:\w+/g, '[^/]+') + '$');
        return routeRegex.test(pathname);
    };

    return Array.isArray(p) ? p.some(matchOne) : matchOne(p);
}

export function isKnownRoute(req: Request): boolean {
    const sanitizedPath = req.path.split('#')[0];
    return getStack(req).some((layer) => matchesLayerPath(layer, sanitizedPath));
}

export function getRoutePattern(req: Request): string {
    const sanitizedUrl = req.originalUrl.split('#')[0].split('?')[0];

    const matched = getStack(req).find((layer) => matchesLayerPath(layer, sanitizedUrl));
    const p = matched?.route?.path;

    if (typeof p === 'string') return p;
    return sanitizedUrl;
}

export function convertStatusToStatusLabel(status: number): string {
    if (status >= 200 && status < 300) {
        return '2xx';
    } else if (status >= 300 && status < 400) {
        return '3xx';
    } else if (status >= 400 && status < 500) {
        return '4xx';
    } else if (status >= 500 && status < 600) {
        return '5xx';
    }
    return 'unknown';
}
