import type { Column, Relation, Schema, Table } from './model';

/** The tables in `ids` (all when omitted) and the relations between them. */
export function subset(schema: Schema, ids?: ReadonlySet<string>): Schema {
  if (!ids) return schema;
  return {
    tables: schema.tables.filter((t) => ids.has(t.id)),
    relations: schema.relations.filter((r) => ids.has(r.from) && ids.has(r.to)),
    warnings: [],
  };
}

const own = (schema: Schema) => schema.tables.filter((t) => !t.external);
const qualified = (t: Table) => `${t.schema}.${t.name}`;
const isGenerated = (c: Column) => c.default?.startsWith('GENERATED ');

// ---------------------------------------------------------------------------------------------- SQL

/**
 * Postgres DDL rebuilt from the model: CREATE TABLEs, then foreign keys as ALTER TABLEs so table
 * order never matters. External tables (e.g. auth.users) are referenced but not created.
 */
export function toSql(schema: Schema): string {
  const tables = own(schema).map((t) => {
    const lines = t.columns.map((c) => {
      const parts = [`  ${c.name} ${c.type}`];
      if (c.identity) parts.push(`GENERATED ${c.generated ?? 'BY DEFAULT AS IDENTITY'}`);
      if (!c.nullable) parts.push('NOT NULL');
      if (c.default !== undefined) parts.push(isGenerated(c) ? c.default : `DEFAULT ${c.default}`);
      if (c.unique) parts.push('UNIQUE');
      if (c.check) parts.push(`CHECK ${c.check}`);
      return parts.join(' ');
    });
    const pk = t.columns.filter((c) => c.primary).map((c) => c.name);
    if (pk.length) lines.push(`  CONSTRAINT ${t.name}_pkey PRIMARY KEY (${pk.join(', ')})`);
    return `CREATE TABLE ${qualified(t)} (\n${lines.join(',\n')}\n);`;
  });

  const byId = new Map(schema.tables.map((t) => [t.id, t]));
  const fks = schema.relations.map((r) => {
    const from = byId.get(r.from)!;
    const name = r.name ?? `${from.name}_${r.fromColumns.join('_')}_fkey`;
    return (
      `ALTER TABLE ${qualified(from)} ADD CONSTRAINT ${name} FOREIGN KEY (${r.fromColumns.join(', ')}) ` +
      `REFERENCES ${qualified(byId.get(r.to)!)}(${r.toColumns.join(', ')});`
    );
  });

  return [...tables, ...(fks.length ? ['', ...fks] : [])].join('\n') + '\n';
}

// ------------------------------------------------------------------------------------------ Mermaid

/** Mermaid `erDiagram`; renders on GitHub, Notion, GitLab and mermaid.live. */
export function toMermaid(schema: Schema): string {
  const name = (t: Table) => (t.schema === 'public' ? t.name : `${t.schema}_${t.name}`);
  const byId = new Map(schema.tables.map((t) => [t.id, t]));
  const fkCols = new Set(schema.relations.flatMap((r) => r.fromColumns.map((c) => `${r.from}.${c}`)));

  const lines = ['erDiagram'];
  for (const t of schema.tables) {
    lines.push(`  ${name(t)} {`);
    for (const c of t.columns) {
      const keys = [c.primary && 'PK', fkCols.has(`${t.id}.${c.name}`) && 'FK', c.unique && !c.primary && 'UK'].filter(Boolean);
      // Mermaid attribute types are a single token
      const type = c.type.replace(/\s+/g, '_').replace(/[^\w\-[\]()]/g, '');
      lines.push(`    ${type || 'unknown'} ${c.name}${keys.length ? ` ${keys.join(', ')}` : ''}`);
    }
    lines.push('  }');
  }
  for (const r of schema.relations) {
    const from = byId.get(r.from)!;
    const optional = r.fromColumns.some((c) => from.columns.find((x) => x.name === c)?.nullable);
    // left = referencing side, right = referenced side
    const left = r.kind === 'one-to-one' ? '|o' : '}o';
    const right = optional ? 'o|' : '||';
    lines.push(`  ${name(from)} ${left}--${right} ${name(byId.get(r.to)!)} : "${r.fromColumns.join(', ')}"`);
  }
  return lines.join('\n') + '\n';
}

// --------------------------------------------------------------------------------------------- DBML

/** DBML, as used by dbdiagram.io and dbdocs. */
export function toDbml(schema: Schema): string {
  const ident = (s: string) => (/^[A-Za-z_]\w*$/.test(s) ? s : `"${s.replace(/"/g, '\\"')}"`);
  const tableRef = (t: Table) => (t.schema === 'public' ? ident(t.name) : `${ident(t.schema)}.${ident(t.name)}`);
  const byId = new Map(schema.tables.map((t) => [t.id, t]));

  const blocks = schema.tables.map((t) => {
    const pk = t.columns.filter((c) => c.primary);
    const lines = t.columns.map((c) => {
      const settings = [
        pk.length === 1 && c.primary && 'pk',
        c.identity && 'increment',
        !c.nullable && !c.primary && 'not null',
        c.unique && 'unique',
        c.default !== undefined && !isGenerated(c) && `default: \`${c.default.replace(/`/g, "'")}\``,
      ].filter(Boolean);
      // `?` marks a column inferred from a reference to a table outside the schema
      const type = c.type === '?' ? 'unknown' : /^[\w[\]()]+$/.test(c.type) ? c.type : `"${c.type}"`;
      return `  ${ident(c.name)} ${type}${settings.length ? ` [${settings.join(', ')}]` : ''}`;
    });
    if (pk.length > 1) lines.push('', '  indexes {', `    (${pk.map((c) => ident(c.name)).join(', ')}) [pk]`, '  }');
    return `Table ${tableRef(t)} {\n${lines.join('\n')}\n}`;
  });

  const cols = (cs: string[]) => (cs.length === 1 ? ident(cs[0]) : `(${cs.map(ident).join(', ')})`);
  const refs = schema.relations.map(
    (r: Relation) =>
      `Ref: ${tableRef(byId.get(r.from)!)}.${cols(r.fromColumns)} ${r.kind === 'one-to-one' ? '-' : '>'} ` +
      `${tableRef(byId.get(r.to)!)}.${cols(r.toColumns)}`,
  );

  return [blocks.join('\n\n'), ...(refs.length ? [refs.join('\n')] : [])].join('\n\n') + '\n';
}

// --------------------------------------------------------------------------------------------- JSON

export const toJson = (schema: Schema) =>
  JSON.stringify({ tables: schema.tables, relations: schema.relations }, null, 2) + '\n';
