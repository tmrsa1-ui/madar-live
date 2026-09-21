/**
 * Vite plugin: serves /api/* locally using the same handlers as production,
 * so `npm run dev` and `npm run preview` work without Vercel/Netlify CLIs.
 */
import { routes } from './handlers.js';

function middleware() {
  return async (req, res, next) => {
    if (!req.url || !req.url.startsWith('/api/')) return next();
    const name = req.url.slice(5).split('?')[0].replace(/\/$/, '');
    const handler = routes[name];
    if (!handler) return next();
    try {
      const request = new Request(`http://localhost${req.url}`, { method: req.method || 'GET' });
      const response = await handler(request);
      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'dev_proxy_error', message: String(err?.message || err) }));
    }
  };
}

export function apiDevMiddleware() {
  return {
    name: 'madar-api-dev',
    configureServer(server) {
      server.middlewares.use(middleware());
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware());
    },
  };
}
