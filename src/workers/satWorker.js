/* Satellite propagation worker: keeps thousands of SGP4 computations off the main thread. */
import { handleMessage } from './satCore.js';

self.onmessage = (e) => handleMessage(e.data, (msg, transfer) => self.postMessage(msg, transfer || []));
