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
  /** Throws when the SQL holds no tables. */
  onApplySql: (sql: string) => Promise<void>;
  onLoadExample: () => void;
  onImportFile: (file: File) => Promise<void>;
  onConnect: (url: string, key: string) => Promise<void>;
}

export default function Sidebar(props: Props) {
  const { schema, sourceLabel } = props;
  const [tab, setTab] = useState<Tab>(() => (schema.tables.length ? 'tables' : 'sql'));
  const own = useMemo(() => schema.tables.filter((t) => !t.external).length, [schema]);

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
          {own.toLocaleString()} tables · {schema.relations.length.toLocaleString()} relations · from {sourceLabel}
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
          onApplySql={async (sql) => {
            await props.onApplySql(sql); // throws on text without tables, keeping the SQL tab open
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

const LIST_LIMIT = 500;
// localeCompare builds its comparison rules on every call: seconds over 100,000 names
const collator = new Intl.Collator();
// A textarea holding megabytes of text takes seconds to lay out; the loaded SQL isn't shown past this
const EDIT_LIMIT = 1024 * 1024;

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

  const sorted = useMemo(
    () => [...schema.tables].sort((a, b) => Number(a.external) - Number(b.external) || collator.compare(a.name, b.name)),
    [schema],
  );
  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () => (q ? sorted.filter((t) => t.id.includes(q) || t.columns.some((c) => c.name.toLowerCase().includes(q))) : sorted),
    [sorted, q],
  );
  // Tens of thousands of rows stall the page; past the cap, searching narrows the list
  const tables = matches.slice(0, LIST_LIMIT);

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
        {matches.length > tables.length && (
          <li className="muted pad">
            Showing {tables.length.toLocaleString()} of {matches.length.toLocaleString()} tables. Search to find the rest.
          </li>
        )}
        {!tables.length && <li className="muted pad">{schema.tables.length ? 'No matches' : `No tables yet. Paste SQL${CAN_CONNECT ? ' or connect a project' : ''}.`}</li>}
      </ul>
    </div>
  );
}

export const SQL_FILE_TYPES = '.sql,.psql,.pgsql,.txt,text/plain,application/sql';

function SqlTab({ sql, schema, onApplySql, onLoadExample, onImportFile }: Props) {
  const [draft, setDraft] = useState(sql.length > EDIT_LIMIT ? '' : sql);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const apply = async (load: () => void | Promise<void>) => {
    setError(null);
    try {
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const dropFile = (e: DragEvent) => {
    const file = e.dataTransfer.files[0];
    if (!file) return; // plain dragged text falls through to the textarea
    e.preventDefault();
    void apply(() => onImportFile(file));
  };

  return (
    <div className="tab-body">
      <p className="muted small">
        Paste, drop or import <code>CREATE TABLE</code> statements (Supabase "Schema for context", pg_dump, migrations), then
        press Visualize.
      </p>
      <textarea
        className="sql-input"
        spellCheck={false}
        value={draft}
        placeholder={
          sql.length > EDIT_LIMIT
            ? `The loaded SQL (${Math.round(sql.length / 1024 / 1024)} MB) is too large to show here. Paste SQL to replace it.`
            : 'CREATE TABLE public.users (…);'
        }
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
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
          if (file) void apply(() => onImportFile(file));
        }}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button className="btn btn--primary" onClick={() => void apply(() => onApplySql(draft))}>
          Visualize
        </button>
        <button className="btn" onClick={() => fileInput.current?.click()}>
          Import .sql file
        </button>
        <button className="btn" onClick={onLoadExample} title="A small made-up blog schema">
          Load example
        </button>
        <button
          className="btn"
          onClick={() => {
            setDraft('');
            setError(null);
          }}
        >
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
