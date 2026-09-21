// Build-time switches.
// VITE_OFFLINE=1 produces a self-contained demo build (e.g. for sandboxed hosting that blocks
// third-party requests): every feed runs on simulated / bundled data and nothing hits the network.
export const OFFLINE = import.meta.env.VITE_OFFLINE === '1';
