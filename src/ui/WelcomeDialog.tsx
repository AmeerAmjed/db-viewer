import { useEffect, useRef, useState, type DragEvent } from 'react';
import { CAN_CONNECT } from '../env';
import { CloseIcon, Logo } from './icons';
import { ConnectTab, SQL_FILE_TYPES } from './Sidebar';

interface Props {
  open: boolean;
  onClose: () => void;
  /** The schema already on screen (restored from this device or loaded earlier), if any. */
  current: { label: string; tables: number; saved: boolean } | null;
  remember: boolean;
  onRememberChange: (on: boolean) => void;
  /** Throws when the SQL holds no tables. */
  onApplySql: (sql: string) => void;
  onLoadExample: () => void;
  onImportFile: (file: File) => Promise<void>;
  onConnect: (url: string, key: string) => Promise<void>;
  initialTab: 'sql' | 'connect';
  /** The app's toast, shown in the dialog while it covers the canvas. */
  toast: string | null;
  /** The app's loading message, shown the same way. */
  busy: string | null;
}

/** Shown on every launch, and again from "Open schema": continue, paste, drop or import a schema. */
export default function WelcomeDialog(props: Props) {
  const { open, onClose, current } = props;
  const ref = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState('');
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'sql' | 'connect'>(CAN_CONNECT ? props.initialTab : 'sql');

  // showModal() gives the focus trap, Escape and the top layer for free
  useEffect(() => {
    const el = ref.current!;
    if (open && !el.open) {
      setError(null); // a failed load from an earlier opening is no longer relevant
      el.showModal();
      // showModal() focuses the first button (Close); start on Continue, the SQL box or the API key instead
      el.querySelector<HTMLElement>('.welcome-resume, .welcome-sql, input[type=password]')?.focus();
    }
    if (!open && el.open) el.close();
  }, [open]);

  // Loading throws when the text holds no tables; the dialog then stays open with the message
  const done = async (load: () => void | Promise<void>) => {
    setError(null);
    try {
      await load();
    } catch (err) {
      setError((err as Error).message);
      return;
    }
    setDraft('');
    onClose();
  };
  const importFile = (file: File) => done(() => props.onImportFile(file));
  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files');

  return (
    <dialog
      ref={ref}
      className="welcome"
      aria-labelledby="welcome-title"
      onClose={onClose}
      // A click on the dialog element itself (not its content) is a click on the backdrop
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="welcome-body">
        <header className="welcome-head">
          <h2 id="welcome-title">
            <Logo size={24} />
            DB Viewer
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </header>
        <p className="muted">Open a Postgres or Supabase schema to draw it as an ER diagram.</p>
        {props.busy ? (
          <p className="welcome-toast welcome-busy" role="status">
            <span className="spinner" aria-hidden="true" />
            {props.busy}
          </p>
        ) : (
          props.toast && (
            <p className="welcome-toast" role="status">
              {props.toast}
            </p>
          )
        )}

        {current && (
          <button className="welcome-resume" onClick={onClose}>
            <span>
              <b>Continue with {current.label}</b>
              <span className="muted small">
                {current.tables} tables{current.saved ? ' · saved on this device' : ''}
              </span>
            </span>
            <span aria-hidden="true">→</span>
          </button>
        )}

        {CAN_CONNECT && (
          <nav className="tabs welcome-tabs" role="tablist">
            {(['sql', 'connect'] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'tab tab--on' : 'tab'} onClick={() => setTab(t)}>
                {t === 'sql' ? 'Paste SQL' : 'Connect Supabase'}
              </button>
            ))}
          </nav>
        )}

        {tab === 'sql' ? (
          <>
            <textarea
              className="sql-input welcome-sql"
              spellCheck={false}
              value={draft}
              placeholder={'Paste CREATE TABLE statements, then press Visualize…\n\nSupabase “Schema for context”, pg_dump or migrations'}
              aria-label="SQL schema"
              onChange={(e) => {
                setDraft(e.target.value);
                setError(null);
              }}
            />
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}

            <div
              className={dragging ? 'welcome-drop welcome-drop--on' : 'welcome-drop'}
              onDragOver={(e) => {
                if (!hasFiles(e)) return;
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
              }}
              onDrop={(e) => {
                if (!hasFiles(e)) return;
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files[0];
                if (file) void importFile(file);
              }}
            >
              Drop a <code>.sql</code> file here or{' '}
              <button className="link-btn" onClick={() => fileInput.current?.click()}>
                choose a file
              </button>
              <input
                ref={fileInput}
                type="file"
                accept={SQL_FILE_TYPES}
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = ''; // lets the same file be picked again
                  if (file) void importFile(file);
                }}
              />
            </div>

            <div className="row">
              <button className="btn btn--primary" onClick={() => void done(() => props.onApplySql(draft))}>
                Visualize
              </button>
              <button className="btn" onClick={() => void done(props.onLoadExample)} title="A small made-up blog schema">
                Load example
              </button>
            </div>
          </>
        ) : (
          <ConnectTab
            onConnect={async (url, key) => {
              await props.onConnect(url, key);
              onClose();
            }}
          />
        )}

        <footer className="welcome-foot">
          <label className="check">
            <input type="checkbox" checked={props.remember} onChange={(e) => props.onRememberChange(e.target.checked)} />
            Remember the schema on this device
          </label>
          <p className="muted small">Kept in this browser only and loaded on your next visit. Unchecking deletes the saved copy.
            {CAN_CONNECT && ' A connected project is only kept until this tab closes, and its API key is never stored.'}</p>
        </footer>
      </div>
    </dialog>
  );
}
