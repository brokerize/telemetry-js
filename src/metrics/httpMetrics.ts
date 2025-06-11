import { getRoutePattern, isKnownRoute } from '../util/httpUtils.ts';
import { httpRequestCounter, httpRequestDurationMicroseconds, httpRequestDurationSum } from './metrics.ts';

export const httpMetricsMiddleWare = ((req, res, next) => {
    if (!isKnownRoute(req)) {
        return next();
    }

    const start = process.hrtime();

    res.on('finish', () => {
        const diff = process.hrtime(start);
        const durationInSeconds = diff[0] + diff[1] / 1e9;

        const routePattern = getRoutePattern(req);

        httpRequestDurationMicroseconds.labels(req.method, res.statusCode.toString()).observe(durationInSeconds);
        httpRequestCounter.labels(req.method, routePattern, res.statusCode.toString()).inc();
        httpRequestDurationSum.labels(req.method, routePattern, res.statusCode.toString()).inc(durationInSeconds);
    });

    next();
}) as import('express').RequestHandler;
