import type { Request } from 'express';

interface Layer {
    route?: { path?: string };
}

type RouterWithStack = { stack: Layer[] };
type AppWithRouters = { router?: RouterWithStack; _router?: RouterWithStack };

function getRouterStack(req: Request): Layer[] {
    const app = req.app as any;

    // lieber NICHT den ganzen stack loggen
    const router = app._router ?? app.router;
    const stack = router?.stack;
    return Array.isArray(stack) ? stack : [];
}

function layerMatchesPath(layer: Layer, pathname: string): boolean {
    const routePath = layer.route?.path;
    if (!routePath) return false;

    const routeRegex = new RegExp('^' + routePath.replace(/:\w+/g, '[^/]+') + '$');
    return routeRegex.test(pathname);
}

export function isKnownRoute(req: Request): boolean {
    const sanitizedPath = req.path.split('#')[0];
    return getRouterStack(req).some((layer) => layerMatchesPath(layer, sanitizedPath));
}

export function getRoutePattern(req: Request): string {
    const sanitizedUrl = req.originalUrl.split('#')[0].split('?')[0];

    const matchedRoute = getRouterStack(req).find((layer) => layerMatchesPath(layer, sanitizedUrl));

    return matchedRoute?.route?.path || sanitizedUrl;
}

export function convertStatusToStatusLabel(status: number): string {
    if (status >= 200 && status < 300) return '2xx';
    if (status >= 300 && status < 400) return '3xx';
    if (status >= 400 && status < 500) return '4xx';
    if (status >= 500 && status < 600) return '5xx';
    return 'unknown';
}
