// Vercel Function (Node.js runtime, Web-standard signature) -> /api/route
import { handleRoute } from '../server/handlers.js';

export function GET(request) {
  return handleRoute(request);
}
