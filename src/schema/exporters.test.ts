import { describe, expect, it } from 'vitest';
import example from './example.sql?raw';
import { subset, toDbml, toJson, toMermaid, toSql } from './exporters';
import { parseSql } from './sqlParser';

const schema = parseSql(example);
const strip = (s: ReturnType<typeof parseSql>) => ({
  tables: s.tables.map((t) => ({ ...t, columns: t.columns.map((c) => ({ ...c })) })),
  relations: s.relations.map(({ name: _name, id: _id, ...r }) => r),
});

describe('toSql', () => {
  it('round-trips through the parser', () => {
    const again = parseSql(toSql(schema));
    expect(again.warnings).toEqual([]);
    expect(strip(again)).toEqual(strip(schema));
  });

  it('keeps identity columns and does not create external tables', () => {
    const sql = toSql(schema);
    expect(sql).toContain('id bigint GENERATED ALWAYS AS IDENTITY NOT NULL');
    expect(sql).not.toContain('CREATE TABLE auth.users');
    expect(sql).toContain('REFERENCES auth.users(id)');
  });
});

describe('toMermaid', () => {
  it('writes entities with keys and crow-foot relations', () => {
    const m = toMermaid(schema);
    expect(m.startsWith('erDiagram\n')).toBe(true);
    expect(m).toContain('    timestamp_with_time_zone created_at');
    expect(m).toContain('    uuid user_id FK, UK');
    expect(m).toContain('  posts }o--|| authors : "author_id"');
    expect(m).toContain('  posts }o--o| posts : "parent_id"'); // nullable self reference
    expect(m).toContain('  post_stats |o--|| posts : "post_id"'); // one-to-one
    expect(m).toContain('  authors |o--|| auth_users : "user_id"');
  });
});

describe('toDbml', () => {
  it('writes tables, composite keys and refs', () => {
    const d = toDbml(schema);
    expect(d).toContain('Table posts {');
    expect(d).toContain('  created_at "timestamp with time zone" [not null, default: `now()`]');
    expect(d).toContain('    (post_id, tag) [pk]');
    expect(d).toContain('Ref: posts.author_id > authors.id');
    expect(d).toContain('Ref: post_stats.post_id - posts.id');
    expect(d).toContain('Ref: authors.user_id - auth.users.id');
    expect(d).toContain('Table auth.users {\n  id unknown [pk]\n}');
    expect(d).toContain('Ref: posts.author_id > authors.id\nRef: posts.parent_id > posts.id');
  });
});

describe('subset and toJson', () => {
  it('keeps only the chosen tables and the relations between them', () => {
    const s = subset(schema, new Set(['public.posts', 'public.authors']));
    expect(s.tables.map((t) => t.name).sort()).toEqual(['authors', 'posts']);
    expect(s.relations.map((r) => `${r.from}->${r.to}`).sort()).toEqual([
      'public.posts->public.authors',
      'public.posts->public.posts',
    ]);
    expect(JSON.parse(toJson(s)).tables).toHaveLength(2);
  });
});
