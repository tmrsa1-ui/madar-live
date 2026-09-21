// Vercel Function (Node.js runtime, Web-standard signature) -> /api/opensky
import { handleOpenSky } from '../server/handlers.js';

export function GET(request) {
  return handleOpenSky(request);
}
