import type { Relation, Schema, Table } from '../schema/model';
import { ArrowRight, CloseIcon, ColumnIcon } from './icons';

interface Props {
  schema: Schema;
  table: Table;
  expanded: boolean;
  onToggleExpanded: () => void;
  onSelect: (id: string) => void;
  onClose: () => void;
}

/** Everything about one table: full column details plus its relations in both directions. */
export default function DetailPanel({ schema, table, expanded, onToggleExpanded, onSelect, onClose }: Props) {
  const outgoing = schema.relations.filter((r) => r.from === table.id);
  const incoming = schema.relations.filter((r) => r.to === table.id);
  const fkColumns = new Set(outgoing.flatMap((r) => r.fromColumns));

  return (
    <aside className="detail">
      <header className="detail-head">
        <div>
          <h2>{table.name}</h2>
          <p className="muted small">
            {table.schema} · {table.columns.length} columns{table.external ? ' · referenced only, columns inferred' : ''}
          </p>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close details">
          <CloseIcon />
        </button>
      </header>

      <button className="btn btn--block" onClick={onToggleExpanded}>
        {expanded ? 'Collapse in diagram' : 'Expand in diagram'}
      </button>

      <section>
        <h3>Columns</h3>
        <ul className="col-list">
          {table.columns.map((c) => {
            const ref = outgoing.find((r) => r.fromColumns.includes(c.name));
            return (
              <li key={c.name}>
                <div className="col-line">
                  <ColumnIcon column={c} foreign={fkColumns.has(c.name)} />
                  <span className="col-name">{c.name}</span>
                  <span className="col-type">{c.type}</span>
                </div>
                <div className="badges">
                  {c.primary && <span className="badge badge--pk">primary key</span>}
                  {ref && (
                    <button className="badge badge--fk" onClick={() => onSelect(ref.to)}>
                      → {label(schema, ref.to)}.{ref.toColumns[ref.fromColumns.indexOf(c.name)] ?? ref.toColumns[0]}
                    </button>
                  )}
                  {c.unique && <span className="badge">unique</span>}
                  {c.identity && <span className="badge">identity</span>}
                  <span className="badge">{c.nullable ? 'nullable' : 'not null'}</span>
                  {c.default !== undefined && <span className="badge mono" title={c.default}>default {c.default}</span>}
                </div>
                {c.check && <code className="check">CHECK {c.check}</code>}
              </li>
            );
          })}
        </ul>
      </section>

      <RelationList title="References" empty="Doesn't reference other tables." relations={outgoing} schema={schema} side="to" onSelect={onSelect} />
      <RelationList title="Referenced by" empty="No tables reference this one." relations={incoming} schema={schema} side="from" onSelect={onSelect} />
    </aside>
  );
}

function RelationList(props: {
  title: string;
  empty: string;
  relations: Relation[];
  schema: Schema;
  side: 'from' | 'to';
  onSelect: (id: string) => void;
}) {
  const { title, empty, relations, schema, side, onSelect } = props;
  return (
    <section>
      <h3>
        {title} <span className="muted">({relations.length})</span>
      </h3>
      {!relations.length && <p className="muted small">{empty}</p>}
      <ul className="rel-list">
        {relations.map((r) => (
          <li key={r.id}>
            <button className="rel" onClick={() => onSelect(side === 'to' ? r.to : r.from)} title={r.name}>
              <span>
                {side === 'from' && <b>{label(schema, r.from)}.</b>}
                {r.fromColumns.join(', ')}
              </span>
              <ArrowRight />
              <span>
                {side === 'to' && <b>{label(schema, r.to)}.</b>}
                {r.toColumns.join(', ')}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const label = (schema: Schema, id: string) => {
  const t = schema.tables.find((x) => x.id === id);
  return !t ? id : t.schema === 'public' ? t.name : t.id;
};
