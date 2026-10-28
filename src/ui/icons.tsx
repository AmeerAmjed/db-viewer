import type { ReactNode } from 'react';
import type { Column } from '../schema/model';

const Svg = ({ children, size = 14, title }: { children: ReactNode; size?: number; title?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden={title ? undefined : true}
    role={title ? 'img' : undefined}
  >
    {title && <title>{title}</title>}
    {children}
  </svg>
);

export const Chevron = ({ open }: { open: boolean }) => (
  <Svg>
    <path d={open ? 'M6 9l6 6 6-6' : 'M9 6l6 6-6 6'} />
  </Svg>
);

export const KeyIcon = () => (
  <Svg size={13} title="Primary key">
    <circle cx="7.5" cy="15.5" r="4.5" />
    <path d="M10.7 12.3 21 2M17 6l3 3M15 8l2 2" />
  </Svg>
);

export const LinkIcon = () => (
  <Svg size={13} title="Foreign key">
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </Svg>
);

export function ColumnIcon({ column, foreign }: { column: Column; foreign: boolean }) {
  if (column.primary) return <span className="ci ci--pk"><KeyIcon /></span>;
  if (foreign) return <span className="ci ci--fk"><LinkIcon /></span>;
  if (column.unique) return <span className="ci ci--uq" title="Unique">◆</span>;
  return <span className="ci ci--plain" title={column.nullable ? 'Nullable' : 'Not null'}>{column.nullable ? '○' : '●'}</span>;
}

export const SunIcon = () => (
  <Svg size={16}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Svg>
);

export const MoonIcon = () => (
  <Svg size={16}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </Svg>
);

export const CloseIcon = () => (
  <Svg size={16}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
);

export const ArrowRight = () => (
  <Svg size={12}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);

export const SidebarIcon = () => (
  <Svg size={16}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
  </Svg>
);

export const DetailsPanelIcon = () => (
  <Svg size={16}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M15 4v16" />
  </Svg>
);

/** The app's logo, same artwork as public/favicon.svg. */
export const Logo = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
    <rect width="64" height="64" rx="14" fill="#121212" />
    <rect x="7" y="10" width="24" height="18" rx="3.5" fill="#1f1f1f" stroke="#3ecf8e" strokeWidth="2.5" />
    <path d="M7 17.5h24" stroke="#3ecf8e" strokeWidth="2.5" />
    <rect x="33" y="36" width="24" height="18" rx="3.5" fill="#1f1f1f" stroke="#3ecf8e" strokeWidth="2.5" />
    <path d="M33 43.5h24" stroke="#3ecf8e" strokeWidth="2.5" />
    <path d="M31 21h7a4 4 0 0 1 4 4v11M38 31h8" fill="none" stroke="#3ecf8e" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);
