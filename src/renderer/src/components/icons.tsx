/**
 * Inline stroke icons (Tabler-style, 24×24, currentColor) so no icon font or
 * external asset is pulled in. Each renders as an <svg> that inherits size via
 * width/height and colour via `currentColor`, so a parent's colour drives it.
 */
type IconProps = { className?: string };

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** ti-sun — Light theme. */
export function IconSun({ className }: IconProps): JSX.Element {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M3 12h1M20 12h1M12 3v1M12 20v1M5.6 5.6l.7 .7M17.7 17.7l.7 .7M18.4 5.6l-.7 .7M6.3 17.7l-.7 .7" />
    </svg>
  );
}

/** ti-moon — Dark theme. */
export function IconMoon({ className }: IconProps): JSX.Element {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z" />
    </svg>
  );
}

/** ti-moon-stars — Dimmed theme. */
export function IconMoonStars({ className }: IconProps): JSX.Element {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z" />
      <path d="M17 4a2 2 0 0 0 2 2a2 2 0 0 0 -2 2a2 2 0 0 0 -2 -2a2 2 0 0 0 2 -2" />
      <path d="M19 11h2m-1 -1v2" />
    </svg>
  );
}

/** ti-plug-connected — Connect action. */
export function IconPlug({ className }: IconProps): JSX.Element {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0V8zM12 17v5" />
    </svg>
  );
}

/** ti-refresh — Load ads action. */
export function IconRefresh({ className }: IconProps): JSX.Element {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4" />
      <path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" />
    </svg>
  );
}
