import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import type { Schema } from '../schema/model';
import { CAN_CONNECT } from '../env';
import { load } from '../storage';
import { CloseIcon, Logo } from './icons';

type Tab = 'tables' | 'sql' | 'connect';

interface Props {
  open: boolean;
  onClose: () => void;
  schema: Schema;
  sourceLabel: string;
  sql: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onApplySql: (sql: string) => void;
  onLoadExample: () => void;
  onImportFile: (file: File) => Promise<void>;
  onConnect: (url: string, key: string) => Promise<void>;
}

export default function Sidebar(props: Props) {
  const { schema, sourceLabel } = props;
  const [tab, setTab] = useState<Tab>(() => (schema.tables.length ? 'tables' : 'sql'));
  const own = schema.tables.filter((t) => !t.external).length;

  // A newly loaded schema (from any source, e.g. the diagram's "load an example" link) shows its tables
  useEffect(() => {
    if (schema.tables.length) setTab('tables');
  }, [schema]);

  return (
    // Hidden rather than unmounted so the search, SQL draft and connect form survive toggling
    <aside className="sidebar" hidden={!props.open}>
      <header className="sidebar-head">
        <h1>
          <Logo size={22} />
          DB Viewer
          {/* Only shown on phones, where the sidebar is a drawer */}
          <button className="icon-btn sidebar-close" onClick={props.onClose} aria-label="Close sidebar">
            <CloseIcon />
          </button>
        </h1>
        <p className="muted">
          {own} tables · {schema.relations.length} relations · from {sourceLabel}
        </p>
      </header>
      <nav className="tabs" role="tablist">
        {(CAN_CONNECT ? (['tables', 'sql', 'connect'] as const) : (['tables', 'sql'] as const)).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'tab tab--on' : 'tab'} onClick={() => setTab(t)}>
            {t === 'tables' ? 'Tables' : t === 'sql' ? 'Paste SQL' : 'Connect'}
          </button>
        ))}
      </nav>
      {tab === 'tables' && <TablesTab {...props} />}
      {tab === 'sql' && (
        <SqlTab
          key={props.sql}
          {...props}
          onApplySql={(sql) => {
            props.onApplySql(sql);
            setTab('tables');
          }}
          onLoadExample={() => {
            props.onLoadExample();
            setTab('tables');
          }}
          onImportFile={async (file) => {
            await props.onImportFile(file);
            setTab('tables');
          }}
        />
      )}
      {tab === 'connect' && CAN_CONNECT && (
        <ConnectTab
          onConnect={async (url, key) => {
            await props.onConnect(url, key);
            setTab('tables');
          }}
        />
      )}
    </aside>
  );
}

function TablesTab({ schema, selectedId, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const counts = useMemo(() => {
    const out = new Map<string, { out: number; in: number }>();
    for (const t of schema.tables) out.set(t.id, { out: 0, in: 0 });
    for (const r of schema.relations) {
      out.get(r.from)!.out++;
      out.get(r.to)!.in++;
    }
    return out;
  }, [schema]);

  const q = query.trim().toLowerCase();
  const tables = [...schema.tables]
    .filter((t) => !q || t.id.includes(q) || t.columns.some((c) => c.name.toLowerCase().includes(q)))
    .sort((a, b) => Number(a.external) - Number(b.external) || a.name.localeCompare(b.name));

  return (
    <div className="tab-body">
      <input
        className="input"
        type="search"
        placeholder="Search tables or columns…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul className="table-list">
        {tables.map((t) => {
          const c = counts.get(t.id)!;
          return (
            <li key={t.id}>
              <button className={t.id === selectedId ? 'tl-item tl-item--on' : 'tl-item'} onClick={() => onSelect(t.id)}>
                <span className="tl-name">
                  {t.name}
                  {t.schema !== 'public' && <span className="tn-schema">{t.schema}</span>}
                </span>
                <span className="tl-meta" title={`${t.columns.length} columns · references ${c.out} · referenced by ${c.in}`}>
                  {t.columns.length} cols · ↗{c.out} ↙{c.in}
                </span>
              </button>
            </li>
          );
        })}
        {!tables.length && <li className="muted pad">{schema.tables.length ? 'No matches' : `No tables yet. Paste SQL${CAN_CONNECT ? ' or connect a project' : ''}.`}</li>}
      </ul>
    </div>
  );
}

export const SQL_FILE_TYPES = '.sql,.psql,.pgsql,.txt,text/plain,application/sql';

function SqlTab({ sql, schema, onApplySql, onLoadExample, onImportFile }: Props) {
  const [draft, setDraft] = useState(sql);
  const fileInput = useRef<HTMLInputElement>(null);
  const dropFile = (e: DragEvent) => {
    const file = e.dataTransfer.files[0];
    if (!file) return; // plain dragged text falls through to the textarea
    e.preventDefault();
    void onImportFile(file);
  };

  return (
    <div className="tab-body">
      <p className="muted small">
        Paste, drop or import <code>CREATE TABLE</code> statements (Supabase "Schema for context", pg_dump, migrations). Pasting
        renders the diagram right away.
      </p>
      <textarea
        className="sql-input"
        spellCheck={false}
        value={draft}
        placeholder="CREATE TABLE public.users (…);"
        onChange={(e) => setDraft(e.target.value)}
        onPaste={(e) => {
          const el = e.currentTarget;
          setTimeout(() => onApplySql(el.value));
        }}
        onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
        onDrop={dropFile}
      />
      <input
        ref={fileInput}
        type="file"
        accept={SQL_FILE_TYPES}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ''; // lets the same file be picked again
          if (file) void onImportFile(file);
        }}
      />
      <div className="row">
        <button className="btn btn--primary" onClick={() => onApplySql(draft)}>
          Visualize
        </button>
        <button className="btn" onClick={() => fileInput.current?.click()}>
          Import .sql file
        </button>
        <button className="btn" onClick={onLoadExample} title="A small made-up blog schema">
          Load example
        </button>
        <button className="btn" onClick={() => setDraft('')}>
          Clear
        </button>
      </div>
      {schema.warnings.length > 0 && (
        <ul className="warnings">
          {schema.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ConnectTab({ onConnect }: { onConnect: (url: string, key: string) => Promise<void> }) {
  const [url, setUrl] = useState(() => load('sv.url') ?? '');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onConnect(url, key);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="tab-body" onSubmit={submit}>
      <p className="muted small">
        Reads the live schema from your project's REST API (Project Settings → API Keys). Supabase only shares the schema with a{' '}
        <b>secret</b> (<code>sb_secret_…</code>) or legacy <b>service_role</b> key; publishable and anon keys are refused. The key
        goes to the local dev server only and is never stored.
      </p>
      <label className="field">
        <span>Project URL</span>
        <input className="input" required placeholder="https://xyzcompany.supabase.co" value={url} onChange={(e) => setUrl(e.target.value)} />
      </label>
      <label className="field">
        <span>API key</span>
        <input className="input" required type="password" autoComplete="off" placeholder="sb_secret_… or service_role eyJ…" value={key} onChange={(e) => setKey(e.target.value)} />
      </label>
      <button className="btn btn--primary" disabled={busy}>
        {busy ? 'Loading…' : 'Load schema'}
      </button>
      {error && <p className="error">{error}</p>}
      <p className="muted small">
        Only the exposed schema (usually <code>public</code>) is available this way, and CHECK constraints are not included.
        Paste SQL for the complete picture.
      </p>
    </form>
  );
}
