import { buildSchema, newColumn, tableId, type Column, type PendingForeignKey, type Schema, type Table } from './model';

/**
 * Parses Postgres DDL (Supabase "schema for context" exports, pg_dump output, migrations) into a
 * Schema. Understands CREATE TABLE plus ALTER TABLE ... ADD [COLUMN | CONSTRAINT]; every other
 * statement is ignored. This is a tolerant reader, not a validator.
 */
export function parseSql(sql: string): Schema {
  const tables = new Map<string, Table>();
  const fks: PendingForeignKey[] = [];
  const warnings: string[] = [];

  for (const stmt of splitStatements(sql)) {
    try {
      const create = CREATE_TABLE.exec(stmt);
      if (create) {
        parseCreateTable(stmt.slice(create[0].length), tables, fks);
        continue;
      }
      const alter = ALTER_TABLE.exec(stmt);
      if (alter) parseAlterTable(stmt.slice(alter[0].length), tables, fks, warnings);
    } catch (err) {
      warnings.push(`Skipped statement "${stmt.slice(0, 60)}…": ${(err as Error).message}`);
    }
  }

  return buildSchema(tables, fks, warnings);
}

const CREATE_TABLE =
  /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:GLOBAL|LOCAL)\s+)?(?:(?:TEMP|TEMPORARY|UNLOGGED)\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?/i;
const ALTER_TABLE = /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?/i;
const TABLE_CONSTRAINT = /^(?:CONSTRAINT|PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|EXCLUDE)\b/i;
const COLUMN_KEYWORD =
  /(NOT\s+NULL|NULL|DEFAULT|CHECK|UNIQUE|PRIMARY\s+KEY|REFERENCES|GENERATED|CONSTRAINT|COLLATE)\b/iy;

function parseCreateTable(rest: string, tables: Map<string, Table>, fks: PendingForeignKey[]) {
  const { schema, name, rest: afterName } = readQualified(rest);
  const group = readParenGroup(afterName);
  if (!group) return; // CREATE TABLE ... AS SELECT / PARTITION OF: no column list to show

  const table: Table = { id: tableId(schema, name), schema, name, columns: [], external: false };
  tables.set(table.id, table);

  for (const item of splitTopLevel(group.inner, ',')) {
    if (!item) continue;
    if (TABLE_CONSTRAINT.test(item)) applyTableConstraint(table, item, fks);
    else if (!/^LIKE\b/i.test(item)) table.columns.push(parseColumn(table, item, fks));
  }
}

function parseAlterTable(rest: string, tables: Map<string, Table>, fks: PendingForeignKey[], warnings: string[]) {
  const { schema, name, rest: actions } = readQualified(rest);
  const table = tables.get(tableId(schema, name));
  if (!table) {
    if (/\bADD\b/i.test(actions)) warnings.push(`ALTER TABLE on undefined table ${tableId(schema, name)}`);
    return;
  }
  for (const action of splitTopLevel(actions, ',')) {
    const add = /^ADD\s+/i.exec(action);
    if (!add) continue;
    const body = action.slice(add[0].length);
    if (TABLE_CONSTRAINT.test(body)) {
      applyTableConstraint(table, body, fks);
    } else {
      const def = body.replace(/^COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?/i, '');
      table.columns.push(parseColumn(table, def, fks));
    }
  }
}

function parseColumn(table: Table, def: string, fks: PendingForeignKey[]): Column {
  const { name, rest } = readIdent(def);
  const { head, clauses } = splitClauses(rest, COLUMN_KEYWORD);
  const col = newColumn(name, head.replace(/\s+/g, ' '));

  clauses.forEach(({ keyword, body }, i) => {
    switch (keyword) {
      case 'NOT NULL':
        col.nullable = false;
        break;
      case 'PRIMARY KEY':
        col.primary = true;
        col.nullable = false;
        break;
      case 'UNIQUE':
        col.unique = true;
        break;
      case 'DEFAULT':
        // `DEFAULT NULL` splits into an empty DEFAULT followed by a NULL clause
        col.default = body || (clauses[i + 1]?.keyword === 'NULL' ? 'NULL' : '');
        break;
      case 'CHECK':
        col.check = body;
        break;
      case 'GENERATED':
        col.identity = /\bIDENTITY\b/i.test(body);
        if (col.identity) col.generated = body;
        else col.default = `GENERATED ${body}`;
        break;
      case 'REFERENCES':
        fks.push({ ...parseReferenceTarget(body), from: table.id, fromColumns: [name] });
        break;
    }
  });
  return col;
}

function applyTableConstraint(table: Table, text: string, fks: PendingForeignKey[]) {
  let rest = text;
  let name: string | undefined;
  const named = /^CONSTRAINT\s+/i.exec(rest);
  if (named) {
    ({ name, rest } = readIdent(rest.slice(named[0].length)));
  }

  const kind = /^(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE)\b/i.exec(rest);
  if (!kind) return; // CHECK / EXCLUDE: nothing to draw
  const group = readParenGroup(rest.slice(kind[0].length));
  if (!group) return;
  const cols = splitTopLevel(group.inner, ',').map((c) => readIdent(c).name);
  const column = (c: string) => table.columns.find((x) => x.name === c);

  switch (kind[1].replace(/\s+/g, ' ').toUpperCase()) {
    case 'PRIMARY KEY':
      for (const c of cols) {
        const col = column(c);
        if (col) {
          col.primary = true;
          col.nullable = false;
        }
      }
      break;
    case 'UNIQUE':
      // Only a single-column UNIQUE makes that column unique on its own
      if (cols.length === 1) {
        const col = column(cols[0]);
        if (col) col.unique = true;
      }
      break;
    case 'FOREIGN KEY': {
      const ref = /^REFERENCES\s+/i.exec(group.rest);
      if (ref) fks.push({ ...parseReferenceTarget(group.rest.slice(ref[0].length)), name, from: table.id, fromColumns: cols });
      break;
    }
  }
}

function parseReferenceTarget(text: string) {
  const { schema, name, rest } = readQualified(text);
  // `REFERENCES users ON DELETE ...` without a column list targets the primary key
  const group = rest.trimStart().startsWith('(') ? readParenGroup(rest) : null;
  const toColumns = group ? splitTopLevel(group.inner, ',').map((c) => readIdent(c).name) : [];
  return { toSchema: schema, toTable: name, toColumns };
}

// ---------------------------------------------------------------------------------------------
// Lexical helpers. All of them skip over '...' and "..." literals and treat (...) / [...] as
// nesting, so commas and keywords inside CHECK expressions or defaults are never split on.

/** Splits a script on top-level semicolons, dropping comments. Handles $tag$ bodies. */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = '';
  const dollar = /\$[A-Za-z_]*\$/y;
  for (let i = 0; i < sql.length; ) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
    } else if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      cur += ' ';
    } else if (ch === "'" || ch === '"') {
      const end = skipQuoted(sql, i);
      cur += sql.slice(i, end);
      i = end;
    } else if (ch === '$' && ((dollar.lastIndex = i), dollar.test(sql))) {
      const tag = sql.slice(i, dollar.lastIndex);
      const close = sql.indexOf(tag, dollar.lastIndex);
      const end = close === -1 ? sql.length : close + tag.length;
      cur += sql.slice(i, end);
      i = end;
    } else if (ch === ';') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      i++;
    } else {
      cur += ch;
      i++;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function skipQuoted(s: string, start: number): number {
  const quote = s[start];
  for (let j = start + 1; j < s.length; j++) {
    if (s[j] !== quote) continue;
    if (s[j + 1] === quote) j++;
    else return j + 1;
  }
  return s.length;
}

/** Calls `visit` for each character outside quotes and brackets; returning true stops the walk. */
function forEachTopLevel(s: string, visit: (i: number) => boolean | void) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'" || ch === '"') {
      i = skipQuoted(s, i) - 1;
    } else if (ch === '(' || ch === '[') {
      depth++;
    } else if (ch === ')' || ch === ']') {
      depth--;
    } else if (depth === 0 && visit(i)) {
      return;
    }
  }
}

export function splitTopLevel(s: string, sep: string): string[] {
  const parts: string[] = [];
  let start = 0;
  forEachTopLevel(s, (i) => {
    if (s[i] === sep) {
      parts.push(s.slice(start, i).trim());
      start = i + 1;
    }
  });
  parts.push(s.slice(start).trim());
  return parts;
}

/** Splits `s` at top-level keywords: text before the first is `head`, the rest are clauses. */
function splitClauses(s: string, keyword: RegExp) {
  const hits: { at: number; end: number; keyword: string }[] = [];
  let skipUntil = 0;
  forEachTopLevel(s, (i) => {
    if (i < skipUntil || (i > 0 && /[\w$]/.test(s[i - 1]))) return;
    keyword.lastIndex = i;
    const m = keyword.exec(s);
    if (!m) return;
    hits.push({ at: i, end: i + m[0].length, keyword: m[1].replace(/\s+/g, ' ').toUpperCase() });
    skipUntil = i + m[0].length;
  });
  return {
    head: s.slice(0, hits[0]?.at ?? s.length).trim(),
    clauses: hits.map((h, k) => ({ keyword: h.keyword, body: s.slice(h.end, hits[k + 1]?.at ?? s.length).trim() })),
  };
}

/** Reads one identifier. Unquoted names are lower-cased the way Postgres folds them. */
function readIdent(s: string): { name: string; rest: string } {
  const t = s.trimStart();
  if (t.startsWith('"')) {
    const end = skipQuoted(t, 0);
    return { name: t.slice(1, end - 1).replace(/""/g, '"'), rest: t.slice(end).trimStart() };
  }
  const m = /^[^\s(),.]+/.exec(t);
  if (!m) throw new Error(`expected identifier near "${t.slice(0, 30)}"`);
  return { name: m[0].toLowerCase(), rest: t.slice(m[0].length).trimStart() };
}

function readQualified(s: string): { schema: string; name: string; rest: string } {
  const first = readIdent(s);
  if (first.rest.startsWith('.')) {
    const second = readIdent(first.rest.slice(1));
    return { schema: first.name, name: second.name, rest: second.rest };
  }
  return { schema: 'public', name: first.name, rest: first.rest };
}

/** Reads the first (...) group in `s`, returning its contents and the text after it. */
function readParenGroup(s: string): { inner: string; rest: string } | null {
  const open = s.indexOf('(');
  if (open === -1) return null;
  let close = -1;
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'" || ch === '"') i = skipQuoted(s, i) - 1;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) {
      close = i;
      break;
    }
  }
  if (close === -1) throw new Error('unbalanced parentheses');
  return { inner: s.slice(open + 1, close), rest: s.slice(close + 1).trim() };
}
