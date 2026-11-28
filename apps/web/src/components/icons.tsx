import type { ReactNode } from 'react';

/**
 * The app's icons: outline drawings on a 24-unit grid with one stroke width, so they read as one set
 * at any size and take the text colour (and the theme) from where they sit.
 */

const CHECKER =
  'M7.75 3.5H12v4.25H7.75ZM16.25 3.5h2.25a2 2 0 0 1 2 2v2.25h-4.25ZM3.5 7.75h4.25V12H3.5ZM12 7.75h4.25V12H12Z' +
  'M7.75 12H12v4.25H7.75ZM16.25 12h4.25v4.25h-4.25ZM3.5 16.25h4.25v4.25H5.5a2 2 0 0 1-2-2ZM12 16.25h4.25v4.25H12Z';

const GEAR =
  'M10.50 4.96L10.83 2.47L13.17 2.47L13.50 4.96A7.2 7.2 0 0 1 15.92 5.96L17.91 4.44L19.56 6.09L18.04 8.08' +
  'A7.2 7.2 0 0 1 19.04 10.50L21.53 10.83L21.53 13.17L19.04 13.50A7.2 7.2 0 0 1 18.04 15.92L19.56 17.91' +
  'L17.91 19.56L15.92 18.04A7.2 7.2 0 0 1 13.50 19.04L13.17 21.53L10.83 21.53L10.50 19.04A7.2 7.2 0 0 1 8.08 18.04' +
  'L6.09 19.56L4.44 17.91L5.96 15.92A7.2 7.2 0 0 1 4.96 13.50L2.47 13.17L2.47 10.83L4.96 10.50' +
  'A7.2 7.2 0 0 1 5.96 8.08L4.44 6.09L6.09 4.44L8.08 5.96A7.2 7.2 0 0 1 10.50 4.96Z';

const ICONS = {
  home: (
    <>
      <path d="M3.5 10.5 12 3.5l8.5 7" />
      <path d="M5.5 9v10.5a1 1 0 0 0 1 1H10V15h4v5.5h3.5a1 1 0 0 0 1-1V9" />
    </>
  ),
  board: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
      <path d={CHECKER} fill="currentColor" stroke="none" />
    </>
  ),
  games: (
    <>
      <path d="M8.5 6h12M8.5 12h12M8.5 18h12" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" strokeWidth={2.6} />
    </>
  ),
  positions: <path d="M6.5 3.5h11a1 1 0 0 1 1 1v16l-6.5-4-6.5 4v-16a1 1 0 0 1 1-1Z" />,
  repertoire: (
    <>
      <path d="M6 3v12" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </>
  ),
  concepts: (
    <>
      <path d="M9.5 18h5M10.5 21.5h3" />
      <path d="M8.5 14.5a6.5 6.5 0 1 1 7 0c-.6.6-1 1.4-1 2.2v1.3h-5v-1.3c0-.8-.4-1.6-1-2.2Z" />
    </>
  ),
  training: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </>
  ),
  settings: (
    <>
      <path d={GEAR} />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20.5 20.5-4.5-4.5" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" />,
  first: <path d="M6 5v14M17 6l-6 6 6 6" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />,
  prev: <path d="M15 6l-6 6 6 6" />,
  next: <path d="M9 6l6 6-6 6" />,
  down: <path d="M6 9l6 6 6-6" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  fold: <path d="M7 4l5 5 5-5M7 20l5-5 5 5" />,
  unfold: <path d="M7 9l5-5 5 5M7 15l5 5 5-5" />,
  last: <path d="M18 5v14M7 6l6 6-6 6" />,
  flip: <path d="M7 20V4M4 7l3-3 3 3M17 4v16M14 17l3 3 3-3" />,
  expand: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
  shrink: <path d="M9 4v5H4M15 4v5h5M20 15h-5v5M4 15h5v5" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.5h.01" />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.25" fill="currentColor" />
      <circle cx="12" cy="12" r="1.25" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.25" fill="currentColor" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable={false}
      className={`shrink-0 ${className ?? ''}`}
    >
      {ICONS[name]}
    </svg>
  );
}
