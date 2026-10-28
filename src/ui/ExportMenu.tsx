import { useCallback, useEffect, useRef, useState } from 'react';
import { useDismiss } from './useDismiss';

export type ExportFormat = 'png' | 'svg' | 'sql' | 'mermaid' | 'dbml' | 'json';
export type CopyFormat = 'image' | 'sql' | 'mermaid' | 'dbml';

export const DOWNLOADS: { format: ExportFormat; label: string; hint: string }[] = [
  { format: 'png', label: 'PNG image', hint: '.png' },
  { format: 'svg', label: 'SVG image', hint: '.svg' },
  { format: 'sql', label: 'SQL', hint: '.sql' },
  { format: 'mermaid', label: 'Mermaid', hint: '.mmd' },
  { format: 'dbml', label: 'DBML', hint: '.dbml' },
  { format: 'json', label: 'JSON', hint: '.json' },
];

export const COPIES: { format: CopyFormat; label: string }[] = [
  { format: 'image', label: 'Image' },
  { format: 'sql', label: 'SQL' },
  { format: 'mermaid', label: 'Mermaid' },
  { format: 'dbml', label: 'DBML' },
];

interface Props {
  disabled: boolean;
  /** Shown under the headings, e.g. "4 visible tables" in focus mode. */
  scope: string;
  onDownload: (format: ExportFormat) => void;
  onCopy: (format: CopyFormat) => void;
}

export default function ExportMenu({ disabled, scope, onDownload, onCopy }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const firstItem = useRef<HTMLButtonElement>(null);

  useDismiss(open, root, useCallback(() => setOpen(false), []));
  useEffect(() => {
    if (open) firstItem.current?.focus();
  }, [open]);

  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div className="export" ref={root}>
      <button className="btn" disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Export ▾
      </button>
      {open && (
        <div className="export-menu" role="menu" aria-label="Export">
          <div className="export-group">
            <span className="export-heading">Download as</span>
            {DOWNLOADS.map((d, i) => (
              <button key={d.format} ref={i === 0 ? firstItem : undefined} role="menuitem" className="export-item" onClick={pick(() => onDownload(d.format))}>
                {d.label}
                <span className="muted">{d.hint}</span>
              </button>
            ))}
          </div>
          <div className="export-group">
            <span className="export-heading">Copy to clipboard</span>
            {COPIES.map((c) => (
              <button key={c.format} role="menuitem" className="export-item" onClick={pick(() => onCopy(c.format))}>
                {c.label}
              </button>
            ))}
          </div>
          <p className="export-scope muted">{scope}</p>
        </div>
      )}
    </div>
  );
}
