-- A small fictional schema in the shape of Supabase's "schema for context" export.
-- WARNING: This schema is for context only and is not meant to be run.

CREATE TABLE public.authors (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  pen_name text NOT NULL,
  genres ARRAY DEFAULT '{}'::text[],
  status USER-DEFINED NOT NULL DEFAULT 'active'::author_status,
  joined_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT authors_pkey PRIMARY KEY (id),
  CONSTRAINT authors_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.posts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL,
  parent_id uuid,
  kind text NOT NULL DEFAULT 'article'::text CHECK (kind = ANY (ARRAY['article'::text, 'note'::text])),
  body text CHECK (char_length(body) <= 5000),
  slug text NOT NULL UNIQUE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT posts_pkey PRIMARY KEY (id),
  CONSTRAINT posts_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.authors(id),
  CONSTRAINT posts_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.posts(id)
);
CREATE TABLE public.post_stats (
  post_id uuid NOT NULL,
  views bigint NOT NULL DEFAULT 0,
  CONSTRAINT post_stats_pkey PRIMARY KEY (post_id),
  CONSTRAINT post_stats_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id)
);
CREATE TABLE public.tags (
  name text NOT NULL,
  CONSTRAINT tags_pkey PRIMARY KEY (name)
);
CREATE TABLE public.post_tags (
  post_id uuid NOT NULL,
  tag text NOT NULL,
  CONSTRAINT post_tags_pkey PRIMARY KEY (post_id, tag),
  CONSTRAINT post_tags_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id),
  CONSTRAINT post_tags_fkey FOREIGN KEY (tag) REFERENCES public.tags(name)
);
CREATE TABLE public.visits (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  post_id uuid NOT NULL,
  latitude double precision,
  CONSTRAINT visits_pkey PRIMARY KEY (id),
  CONSTRAINT visits_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id)
);
