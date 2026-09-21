// Vercel Function (Node.js runtime, Web-standard signature) -> /api/tle
import { handleTle } from '../server/handlers.js';

export function GET(request) {
  return handleTle(request);
}
