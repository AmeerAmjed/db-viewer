export interface Column {
  name: string;
  type: string;
  nullable: boolean;
  primary: boolean;
  unique: boolean;
  identity: boolean;
  default?: string;
  check?: string;
}

export interface Table {
  /** `schema.name`, lower-cased for unquoted identifiers (Postgres semantics). */
  id: string;
  schema: string;
  name: string;
  columns: Column[];
  /** Only known because something references it (e.g. `auth.users`); columns are inferred. */
  external: boolean;
}

export interface Relation {
  id: string;
  name?: string;
  from: string;
  fromColumns: string[];
  to: string;
  toColumns: string[];
}

export interface Schema {
  tables: Table[];
  relations: Relation[];
  warnings: string[];
}

/** A foreign key as written in the source, before its target table is resolved. */
export interface PendingForeignKey {
  name?: string;
  from: string;
  fromColumns: string[];
  toSchema: string;
  toTable: string;
  /** Empty means "the target's primary key". */
  toColumns: string[];
}

export const tableId = (schema: string, name: string) => `${schema}.${name}`;

export function newColumn(name: string, type: string): Column {
  return { name, type, nullable: true, primary: false, unique: false, identity: false };
}

/**
 * Resolves foreign keys against the collected tables. Targets that were never defined become
 * `external` placeholder tables so their relations can still be drawn.
 */
export function buildSchema(tables: Map<string, Table>, fks: PendingForeignKey[], warnings: string[]): Schema {
  const relations: Relation[] = [];
  const seen = new Map<string, number>();

  for (const fk of fks) {
    if (!tables.has(fk.from)) {
      warnings.push(`Foreign key on unknown table ${fk.from}`);
      continue;
    }
    const to = tableId(fk.toSchema, fk.toTable);
    let target = tables.get(to);
    let toColumns = fk.toColumns;

    if (!target) {
      const cols = toColumns.length ? toColumns : ['id'];
      target = {
        id: to,
        schema: fk.toSchema,
        name: fk.toTable,
        external: true,
        columns: cols.map((c) => ({ ...newColumn(c, '?'), primary: true, nullable: false })),
      };
      tables.set(to, target);
    } else if (target.external) {
      for (const c of toColumns) {
        if (!target.columns.some((x) => x.name === c)) {
          target.columns.push({ ...newColumn(c, '?'), nullable: false });
        }
      }
    }
    if (!toColumns.length) toColumns = target.columns.filter((c) => c.primary).map((c) => c.name);

    const key = `${fk.from}(${fk.fromColumns})->${to}(${toColumns})`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    relations.push({
      id: n ? `${key}#${n}` : key,
      name: fk.name,
      from: fk.from,
      fromColumns: fk.fromColumns,
      to,
      toColumns,
    });
  }

  return { tables: [...tables.values()], relations, warnings };
}

/** Column names of `table` that take part in an outgoing foreign key. */
export function foreignKeyColumns(schema: Schema, table: string): Set<string> {
  const out = new Set<string>();
  for (const r of schema.relations) if (r.from === table) r.fromColumns.forEach((c) => out.add(c));
  return out;
}
