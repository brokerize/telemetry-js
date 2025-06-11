import type { Request } from 'express';

interface Layer {
    route?: { path: string };
}

export function isKnownRoute(req: Request): boolean {
    const sanitizedPath = req.path.split('#')[0];

    return req.app._router.stack.some((layer: Layer) => {
        if (!layer.route || !layer.route.path) return false;

        // Ersetze die Platzhalter durch Regex
        const routeRegex = new RegExp('^' + layer.route.path.replace(/:\w+/g, '[^/]+') + '$');

        return routeRegex.test(sanitizedPath);
    });
}

export function getRoutePattern(req: Request): string {
    const sanitizedUrl = req.originalUrl.split('#')[0].split('?')[0];

    const matchedRoute = req.app._router.stack.find((layer: Layer) => {
        if (!layer.route || !layer.route.path) return false;

        const routeRegex = new RegExp('^' + layer.route.path.replace(/:\w+/g, '[^/]+') + '$');

        return routeRegex.test(sanitizedUrl);
    });

    const routePattern = matchedRoute?.route?.path || sanitizedUrl;
    return routePattern;
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
