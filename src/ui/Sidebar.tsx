import { useMemo, useState, type FormEvent } from 'react';
import type { Schema } from '../schema/model';
import { load } from '../storage';

type Tab = 'tables' | 'sql' | 'connect';

interface Props {
  schema: Schema;
  sourceLabel: string;
  sql: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onApplySql: (sql: string) => void;
  onLoadSample: () => void;
  onConnect: (url: string, key: string) => Promise<void>;
}

export default function Sidebar(props: Props) {
  const { schema, sourceLabel } = props;
  const [tab, setTab] = useState<Tab>(() => (schema.tables.length ? 'tables' : 'sql'));
  const own = schema.tables.filter((t) => !t.external).length;

  return (
    <aside className="sidebar">
      <header className="sidebar-head">
        <h1>Superbase Viewer</h1>
        <p className="muted">
          {own} tables · {schema.relations.length} relations · from {sourceLabel}
        </p>
      </header>
      <nav className="tabs" role="tablist">
        {(['tables', 'sql', 'connect'] as const).map((t) => (
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
          onLoadSample={() => {
            props.onLoadSample();
            setTab('tables');
          }}
        />
      )}
      {tab === 'connect' && (
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
        {!tables.length && <li className="muted pad">{schema.tables.length ? 'No matches' : 'No tables yet. Paste SQL or connect a project.'}</li>}
      </ul>
    </div>
  );
}

function SqlTab({ sql, schema, onApplySql, onLoadSample }: Props) {
  const [draft, setDraft] = useState(sql);
  return (
    <div className="tab-body">
      <p className="muted small">
        Paste <code>CREATE TABLE</code> statements (Supabase "Schema for context", pg_dump, migrations). Pasting renders the diagram
        right away.
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
      />
      <div className="row">
        <button className="btn btn--primary" onClick={() => onApplySql(draft)}>
          Visualize
        </button>
        <button className="btn" onClick={onLoadSample}>
          Load sample
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

function ConnectTab({ onConnect }: { onConnect: (url: string, key: string) => Promise<void> }) {
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
        Reads the live schema from your project's REST API (Project Settings → API). Use the <b>secret</b> or <b>service_role</b> key
        for the full schema; an anon/publishable key only shows what that role is allowed to see. The key goes to the local dev
        server only and is never stored.
      </p>
      <label className="field">
        <span>Project URL</span>
        <input className="input" required placeholder="https://xyzcompany.supabase.co" value={url} onChange={(e) => setUrl(e.target.value)} />
      </label>
      <label className="field">
        <span>API key</span>
        <input className="input" required type="password" autoComplete="off" placeholder="sb_secret_… or eyJ…" value={key} onChange={(e) => setKey(e.target.value)} />
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
