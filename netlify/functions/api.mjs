// Netlify Function (v2 API) serving /api/opensky, /api/route and /api/tle
import { routes } from '../../server/handlers.js';

export default async (request) => {
  const name = new URL(request.url).pathname.replace(/^\/api\//, '').replace(/\/$/, '');
  const handler = routes[name];
  if (!handler) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
  return handler(request);
};

export const config = {
  path: ['/api/opensky', '/api/route', '/api/tle'],
};
