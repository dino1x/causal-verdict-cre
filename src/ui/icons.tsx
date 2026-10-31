// Inline stroke icons (24px grid, currentColor) so the UI needs no icon dependency.
import type { ReactNode } from "react";

const I = ({ children, size = 16 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const Icon = {
  judge: (p: { size?: number }) => <I {...p}><path d="M12 3v18" /><path d="M5 21h14" /><path d="M4 7h16" /><path d="M7 7l-3 7a3 3 0 0 0 6 0z" /><path d="M17 7l-3 7a3 3 0 0 0 6 0z" /></I>,
  verdict: (p: { size?: number }) => <I {...p}><path d="M3 12h4l3-8 4 16 3-8h4" /></I>,
  ledger: (p: { size?: number }) => <I {...p}><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></I>,
  causality: (p: { size?: number }) => <I {...p}><circle cx="5" cy="6" r="2" /><circle cx="19" cy="6" r="2" /><circle cx="12" cy="18" r="2" /><path d="M7 6h10M6 8l5 8M18 8l-5 8" /></I>,
  debate: (p: { size?: number }) => <I {...p}><path d="M4 5h10v7H8l-4 3z" /><path d="M14 9h6v7l-3-2h-5v-2" /></I>,
  mandate: (p: { size?: number }) => <I {...p}><path d="M7 3h8l4 4v14H7z" /><path d="M15 3v4h4" /><path d="M10 12h6M10 16h6" /></I>,
  chain: (p: { size?: number }) => <I {...p}><rect x="3" y="9" width="8" height="6" rx="3" /><rect x="13" y="9" width="8" height="6" rx="3" /><path d="M9 12h6" /></I>,
  audit: (p: { size?: number }) => <I {...p}><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" /></I>,
  play: (p: { size?: number }) => <I {...p}><path d="M7 5l12 7-12 7z" /></I>,
  sun: (p: { size?: number }) => <I {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></I>,
  moon: (p: { size?: number }) => <I {...p}><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" /></I>,
  external: (p: { size?: number }) => <I {...p}><path d="M14 4h6v6" /><path d="M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></I>,
  bolt: (p: { size?: number }) => <I {...p}><path d="M13 2L4 14h7l-1 8 9-12h-7z" /></I>,
  check: (p: { size?: number }) => <I {...p}><path d="M5 12l5 5 9-10" /></I>,
};

export const Logo = ({ size = 30 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="8" fill="var(--ink)" />
    <path d="M8.5 17l4.5 4.5L23.5 11" stroke="var(--on-ink)" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="23.5" cy="11" r="2" fill="var(--accent-2)" />
  </svg>
);
