import type { RequestHandler } from 'express';
import { getRoutePattern, isKnownRoute } from '../util/httpUtils.ts';
import { httpRequestCounter, httpRequestDurationSeconds, httpRequestDurationSum } from './metrics.ts';

export const httpMetricsMiddleWare: RequestHandler = (req, res, next) => {
    if (!isKnownRoute(req)) {
        return next();
    }

    const routePattern = getRoutePattern(req);
    const start = process.hrtime();

    res.on('finish', () => {
        const diff = process.hrtime(start);
        const durationInSeconds = diff[0] + diff[1] / 1e9;

        httpRequestDurationSeconds
            .labels({ method: req.method, status_code: res.statusCode.toString() })
            .observe(durationInSeconds);
        httpRequestCounter
            .labels({ method: req.method, route: routePattern, status_code: res.statusCode.toString() })
            .inc();
        httpRequestDurationSum
            .labels({ method: req.method, route: routePattern, status_code: res.statusCode.toString() })
            .inc(durationInSeconds);
    });

    next();
};
