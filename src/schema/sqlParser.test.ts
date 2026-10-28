import { describe, expect, it } from 'vitest';
import sample from '../sample.sql?raw';
import { parseOpenApi } from './openApi';
import { parseSql } from './sqlParser';

const table = (s: ReturnType<typeof parseSql>, id: string) => s.tables.find((t) => t.id === id)!;
const column = (s: ReturnType<typeof parseSql>, id: string, name: string) =>
  table(s, id).columns.find((c) => c.name === name)!;

describe('parseSql on a Supabase-style export', () => {
  const schema = parseSql(sample);

  it('finds every table plus the referenced auth.users', () => {
    expect(schema.warnings).toEqual([]);
    expect(schema.tables.filter((t) => !t.external)).toHaveLength(6);
    expect(schema.tables.filter((t) => t.external).map((t) => t.id)).toEqual(['auth.users']);
  });

  it('keeps multi-word and Supabase placeholder types', () => {
    expect(column(schema, 'public.posts', 'created_at').type).toBe('timestamp with time zone');
    expect(column(schema, 'public.visits', 'latitude').type).toBe('double precision');
    expect(column(schema, 'public.authors', 'genres').type).toBe('ARRAY');
    expect(column(schema, 'public.authors', 'status').type).toBe('USER-DEFINED');
  });

  it('reads nullability, defaults, checks, identity and unique', () => {
    const kind = column(schema, 'public.posts', 'kind');
    expect(kind.nullable).toBe(false);
    expect(kind.check).toContain("ARRAY['article'::text, 'note'::text]");
    expect(kind.default).toBe("'article'::text");
    expect(column(schema, 'public.posts', 'body').nullable).toBe(true);
    expect(column(schema, 'public.visits', 'id')).toMatchObject({ type: 'bigint', identity: true });
    expect(column(schema, 'public.posts', 'slug').unique).toBe(true);
  });

  it('applies composite primary keys', () => {
    const cols = table(schema, 'public.post_tags').columns.filter((c) => c.primary).map((c) => c.name);
    expect(cols).toEqual(['post_id', 'tag']);
  });

  it('resolves foreign keys, including self references and duplicate constraint names', () => {
    const from = (id: string) => schema.relations.filter((r) => r.from === id);
    expect(schema.relations).toHaveLength(7);
    expect(from('public.posts')).toContainEqual(
      expect.objectContaining({ fromColumns: ['parent_id'], to: 'public.posts', toColumns: ['id'] }),
    );
    expect(from('public.post_tags').map((r) => r.to).sort()).toEqual(['public.posts', 'public.tags']);
    expect(new Set(schema.relations.map((r) => r.id)).size).toBe(schema.relations.length);
  });

  it('classifies relations as one-to-one when the FK columns are unique or the primary key', () => {
    const kind = (from: string, col: string) => schema.relations.find((r) => r.from === from && r.fromColumns[0] === col)!.kind;
    expect(kind('public.posts', 'author_id')).toBe('many-to-one');
    expect(kind('public.post_stats', 'post_id')).toBe('one-to-one'); // PK
    expect(kind('public.authors', 'user_id')).toBe('one-to-one'); // UNIQUE
    expect(kind('public.post_tags', 'post_id')).toBe('many-to-one'); // part of a composite PK
  });
});

describe('parseSql on other dialects', () => {
  it('handles inline references, quoted names, comments and ALTER TABLE', () => {
    const schema = parseSql(`
      /* block; comment */
      create table if not exists "Authors" (
        "Id" serial primary key,
        name varchar(120) not null default 'x;y' -- trailing; comment
      );
      CREATE TABLE books (
        id int,
        author_id int references "Authors" on delete cascade,
        price numeric(10, 2) default null
      );
      ALTER TABLE ONLY public.books ADD CONSTRAINT books_pkey PRIMARY KEY (id);
      ALTER TABLE books ADD COLUMN isbn text UNIQUE;
      CREATE FUNCTION f() RETURNS void AS $$ begin; end; $$ LANGUAGE plpgsql;
    `);
    expect(schema.warnings).toEqual([]);
    expect(column(schema, 'public.Authors', 'Id')).toMatchObject({ primary: true, nullable: false });
    expect(column(schema, 'public.Authors', 'name')).toMatchObject({ type: 'varchar(120)', default: "'x;y'" });
    expect(column(schema, 'public.books', 'price')).toMatchObject({ type: 'numeric(10, 2)', default: 'NULL' });
    expect(column(schema, 'public.books', 'id').primary).toBe(true);
    expect(column(schema, 'public.books', 'isbn').unique).toBe(true);
    expect(schema.relations).toEqual([
      expect.objectContaining({ from: 'public.books', fromColumns: ['author_id'], to: 'public.Authors', toColumns: ['Id'] }),
    ]);
  });
});

describe('parseOpenApi', () => {
  it('reads PostgREST pk/fk annotations', () => {
    const schema = parseOpenApi({
      definitions: {
        posts: {
          required: ['id'],
          properties: {
            id: { type: 'string', format: 'uuid', description: 'Note:\nThis is a Primary Key.<pk/>' },
            author_id: {
              type: 'string',
              format: 'uuid',
              description: "Note:\nThis is a Foreign Key to `authors.id`.<fk table='authors' column='id'/>",
            },
          },
        },
      },
    });
    expect(column(schema, 'public.posts', 'id')).toMatchObject({ primary: true, nullable: false, type: 'uuid' });
    expect(schema.relations[0]).toMatchObject({ from: 'public.posts', to: 'public.authors', toColumns: ['id'] });
    expect(table(schema, 'public.authors').external).toBe(true);
  });
});
