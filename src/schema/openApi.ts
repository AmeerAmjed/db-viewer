import { buildSchema, newColumn, tableId, type PendingForeignKey, type Schema, type Table } from './model';

interface OpenApiProperty {
  type?: string;
  format?: string;
  default?: unknown;
  description?: string;
  enum?: unknown[];
}

interface OpenApiSpec {
  definitions?: Record<string, { required?: string[]; properties?: Record<string, OpenApiProperty> }>;
}

/**
 * Converts the OpenAPI 2.0 document PostgREST serves at `/rest/v1/` into a Schema. PostgREST
 * encodes keys in each column's description as `<pk/>` and `<fk table='t' column='c'/>`.
 * Only tables and views in the exposed schema appear (normally `public`).
 */
export function parseOpenApi(spec: OpenApiSpec, schema = 'public'): Schema {
  const tables = new Map<string, Table>();
  const fks: PendingForeignKey[] = [];
  const warnings: string[] = [];

  if (!spec.definitions) {
    warnings.push('The response contained no table definitions. Does this key have access to the schema?');
  }

  for (const [name, def] of Object.entries(spec.definitions ?? {})) {
    const id = tableId(schema, name);
    const required = new Set(def.required ?? []);
    const table: Table = { id, schema, name, columns: [], external: false };

    for (const [colName, prop] of Object.entries(def.properties ?? {})) {
      const col = newColumn(colName, prop.format ?? prop.type ?? '?');
      const description = prop.description ?? '';
      col.nullable = !required.has(colName);
      col.primary = description.includes('<pk/>');
      if (prop.default !== undefined) col.default = String(prop.default);
      if (prop.enum?.length) col.check = `one of: ${prop.enum.join(', ')}`;
      table.columns.push(col);

      for (const m of description.matchAll(/<fk table='([^']+)' column='([^']+)'\/>/g)) {
        const [toSchema, toTable] = m[1].includes('.') ? m[1].split('.', 2) : [schema, m[1]];
        fks.push({ from: id, fromColumns: [colName], toSchema, toTable, toColumns: [m[2]] });
      }
    }
    tables.set(id, table);
  }

  return buildSchema(tables, fks, warnings);
}
