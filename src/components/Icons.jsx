// Small inline SVG icon set (stroke icons, currentColor).
const base = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };

export const Icon = {
  plane: (p) => (
    <svg {...base} {...p}>
      <path d="M12 2.5c.9 0 1.4 1 1.4 2.2v5l7.1 4.2v2l-7.1-2.2v4.1l2.2 1.7v1.6L12 20.2l-3.6.9v-1.6l2.2-1.7v-4.1l-7.1 2.2v-2l7.1-4.2v-5c0-1.2.5-2.2 1.4-2.2z" fill="currentColor" stroke="none" />
    </svg>
  ),
  search: (p) => (
    <svg {...base} {...p}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </svg>
  ),
  layers: (p) => (
    <svg {...base} {...p}>
      <path d="m12 3 9 5-9 5-9-5 9-5z" />
      <path d="m3 13 9 5 9-5" />
    </svg>
  ),
  close: (p) => (
    <svg {...base} {...p}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  ),
  globe: (p) => (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18" />
    </svg>
  ),
  map: (p) => (
    <svg {...base} {...p}>
      <path d="m9 4-6 2.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5L9 4z" />
      <path d="M9 4v13.5M15 6.5V20" />
    </svg>
  ),
  quake: (p) => (
    <svg {...base} {...p}>
      <path d="M2 12h4l2-5 3 10 3-13 2.5 8H22" />
    </svg>
  ),
  sat: (p) => (
    <svg {...base} {...p}>
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" transform="rotate(45 12 12)" />
      <path d="m7.5 7.5-3-3m12 12 3 3M5 9 2.5 6.5l4-4L9 5m6 14 2.5 2.5 4-4L19 15" />
    </svg>
  ),
  city: (p) => (
    <svg {...base} {...p}>
      <path d="M4 21V9l5-3v15M9 21V4l7 3v14M16 21v-9l4 2v7M2 21h20" />
    </svg>
  ),
  pin: (p) => (
    <svg {...base} {...p}>
      <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  ),
  flag: (p) => (
    <svg {...base} {...p}>
      <path d="M5 21V4m0 0h11l-2 4 2 4H5" />
    </svg>
  ),
  target: (p) => (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  ),
  follow: (p) => (
    <svg {...base} {...p}>
      <path d="M3 12h3M18 12h3M12 3v3M12 18v3" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  ),
  filter: (p) => (
    <svg {...base} {...p}>
      <path d="M4 5h16l-6 7.5V19l-4 1.5v-8L4 5z" />
    </svg>
  ),
  external: (p) => (
    <svg {...base} {...p}>
      <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  ),
  cloud: (p) => (
    <svg {...base} {...p}>
      <path d="M7 18h10a4 4 0 0 0 .6-8 6 6 0 0 0-11.4 1.6A3.3 3.3 0 0 0 7 18z" />
    </svg>
  ),
  radar: (p) => (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <path d="M12 12 19 5" />
    </svg>
  ),
  sun: (p) => (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  ),
  rotate: (p) => (
    <svg {...base} {...p}>
      <path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4" />
    </svg>
  ),
  arc: (p) => (
    <svg {...base} {...p}>
      <path d="M3 18c3-10 15-10 18 0" strokeDasharray="3 2.5" />
      <circle cx="3" cy="18" r="1.6" fill="currentColor" />
      <circle cx="21" cy="18" r="1.6" fill="currentColor" />
    </svg>
  ),
  heat: (p) => (
    <svg {...base} {...p}>
      <path d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-3.5 2-5 1 1.5 1.5 2 2.5 2C11.5 7.5 11 5.5 12 3z" />
    </svg>
  ),
  borders: (p) => (
    <svg {...base} {...p}>
      <path d="M4 6l5-2 6 3 5-2v13l-5 2-6-3-5 2z" strokeDasharray="2.6 2" />
    </svg>
  ),
  starlink: (p) => (
    <svg {...base} {...p}>
      <circle cx="5" cy="7" r="1.2" fill="currentColor" />
      <circle cx="10" cy="9" r="1.2" fill="currentColor" />
      <circle cx="15" cy="11" r="1.2" fill="currentColor" />
      <circle cx="20" cy="13" r="1.2" fill="currentColor" />
      <path d="M3 18c6-3 12-3 18 0" />
    </svg>
  ),
  chevron: (p) => (
    <svg {...base} {...p}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  ),
};
