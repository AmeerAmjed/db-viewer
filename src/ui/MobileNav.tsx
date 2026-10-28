import { useCallback, useRef, useState, type ReactNode } from 'react';
import { COPIES, DOWNLOADS, type CopyFormat, type ExportFormat } from './ExportMenu';
import { CheckIcon, FocusIcon, Logo, MenuIcon, MoreIcon } from './icons';
import { useDismiss } from './useDismiss';

interface Props {
  title: string;
  onOpenSidebar: () => void;
  focus: boolean;
  onToggleFocus: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onArrange: () => void;
  dark: boolean;
  onToggleTheme: () => void;
  /** Only offered while a table is selected. */
  details: { open: boolean; onToggle: () => void } | null;
  canExport: boolean;
  exportScope: string;
  onDownload: (format: ExportFormat) => void;
  onCopy: (format: CopyFormat) => void;
}

/**
 * The phone layout's top bar: sidebar button, title, Focus, and a ⋮ menu holding everything the
 * desktop toolbar shows as separate buttons.
 */
export default function MobileNav(props: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, root, close);

  const item = (label: string, onClick: () => void, end?: ReactNode) => (
    <button
      key={label}
      role="menuitem"
      className="export-item"
      onClick={() => {
        close();
        onClick();
      }}
    >
      {label}
      {end}
    </button>
  );
  const toggle = (label: string, on: boolean, onClick: () => void) => (
    <button
      key={label}
      role="menuitemcheckbox"
      aria-checked={on}
      className="export-item"
      onClick={() => {
        close();
        onClick();
      }}
    >
      {label}
      {on && <CheckIcon />}
    </button>
  );

  return (
    <nav className="mnav" aria-label="Diagram">
      <button className="icon-btn mnav-btn" onClick={props.onOpenSidebar} aria-label="Open sidebar">
        <MenuIcon />
      </button>
      <span className="mnav-title">
        <Logo size={22} />
        <span>{props.title}</span>
      </span>
      <button
        className={props.focus ? 'icon-btn mnav-btn icon-btn--on' : 'icon-btn mnav-btn'}
        onClick={props.onToggleFocus}
        aria-pressed={props.focus}
        aria-label="Focus mode"
        title="Focus mode"
      >
        <FocusIcon />
      </button>
      <div className="mnav-more" ref={root}>
        <button className="icon-btn mnav-btn" aria-haspopup="menu" aria-expanded={open} aria-label="More" onClick={() => setOpen((o) => !o)}>
          <MoreIcon />
        </button>
        {open && (
          <div className="export-menu mnav-menu" role="menu" aria-label="More">
            <div className="export-group">
              <span className="export-heading">View</span>
              {toggle('Focus mode', props.focus, props.onToggleFocus)}
              {item('Expand all', props.onExpandAll)}
              {item('Collapse all', props.onCollapseAll)}
              {item('Arrange', props.onArrange)}
              {props.details && toggle('Table details', props.details.open, props.details.onToggle)}
              {toggle('Dark theme', props.dark, props.onToggleTheme)}
            </div>
            {props.canExport && (
              <>
                <div className="export-group">
                  <span className="export-heading">Download as</span>
                  {DOWNLOADS.map((d) => item(d.label, () => props.onDownload(d.format), <span className="muted">{d.hint}</span>))}
                </div>
                <div className="export-group">
                  <span className="export-heading">Copy to clipboard</span>
                  {COPIES.map((c) => item(`Copy ${c.label}`, () => props.onCopy(c.format)))}
                </div>
                <p className="export-scope muted">{props.exportScope}</p>
              </>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}
