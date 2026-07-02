-- Influencer KB — RAG over the tip-block compendiums we build per influencer.
--
-- Source of truth is the per-influencer compendium (e.g.
-- influencer-kb/<coach>/COMPENDIUM.json). Each "nugget" is one tip block:
-- a heading/context line, a Tip, a verbatim Source quote, and a Source link
-- (local transcript .md + the original Instagram post). We embed each block and
-- keep the parsed pieces in their own columns so the coach agent can both
-- semantically retrieve a tip AND cite its exact source.
--
-- Access model matches the rest of this project: the agent talks to the DB with
-- the SERVICE ROLE key (bypasses RLS). RLS is enabled with NO policies so the
-- anon/public key can read nothing if it ever leaks.

-- vector extension is already created in 0001_init.sql; this is a no-op if so.
create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- One row per tip block, per influencer.
-- ---------------------------------------------------------------------------
create table influencer_tips (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),

  influencer    text not null,          -- 'example_coach' — which KB this block came from
  topic         text,                   -- 'Fat Loss & Calories'

  -- The parsed tip block (the four lines shown in the compendium markdown)
  title         text,                   -- the ### heading / context line
  tip           text not null,          -- the distilled actionable tip
  source_quote  text,                   -- verbatim sentence from the transcript
  source_type   text,                   -- how the quote was picked (e.g. 'best-source-sentence')
  score         int,                    -- extraction relevance score

  -- Source / provenance, so any retrieved tip can be cited back
  shortcode     text,                   -- Instagram shortcode, e.g. 'DZ14OU7h6FP'
  url           text,                   -- https://www.instagram.com/p/<shortcode>/
  source_file   text,                   -- repo-relative path to the transcript .md
  published_at  timestamptz,            -- when the original post went up

  block_md      text,                   -- the full rendered markdown tip block (original text)
  embed_input   text,                   -- exact text handed to the embedding model
  embedding     vector(1536),           -- OpenAI text-embedding-3-small; for semantic recall

  metadata      jsonb,                  -- full raw nugget, for anything not promoted to a column

  -- md5(influencer | shortcode | tip) — makes ingestion an idempotent upsert
  content_hash  text not null
);

-- Idempotent re-ingestion: upsert on this key (PostgREST on_conflict=content_hash).
create unique index influencer_tips_content_hash_idx on influencer_tips (content_hash);
create index influencer_tips_influencer_idx on influencer_tips (influencer);
create index influencer_tips_topic_idx on influencer_tips (topic);
create index influencer_tips_published_at_idx on influencer_tips (published_at desc);
-- HNSW needs no training data, unlike ivfflat. Cosine distance for semantic recall.
create index influencer_tips_embedding_idx on influencer_tips using hnsw (embedding vector_cosine_ops);

alter table influencer_tips enable row level security;

-- ---------------------------------------------------------------------------
-- Semantic recall over the tip blocks.
-- pgvector cosine distance. Callable via PostgREST: /rest/v1/rpc/match_influencer_tips
-- ---------------------------------------------------------------------------
create or replace function match_influencer_tips(
  query_embedding   vector(1536),
  match_count       int  default 10,
  filter_influencer text default null,
  filter_topic      text default null
)
returns table (
  id           bigint,
  influencer   text,
  topic        text,
  title        text,
  tip          text,
  source_quote text,
  url          text,
  source_file  text,
  published_at timestamptz,
  similarity   float
)
language sql stable as $$
  select t.id, t.influencer, t.topic, t.title, t.tip, t.source_quote,
         t.url, t.source_file, t.published_at,
         1 - (t.embedding <=> query_embedding) as similarity
  from influencer_tips t
  where t.embedding is not null
    and (filter_influencer is null or t.influencer = filter_influencer)
    and (filter_topic is null or t.topic = filter_topic)
  order by t.embedding <=> query_embedding
  limit match_count;
$$;
