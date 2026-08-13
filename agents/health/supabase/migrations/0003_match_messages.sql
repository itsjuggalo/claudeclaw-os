-- Semantic recall over the conversation log.
-- pgvector cosine distance. Callable via PostgREST: /rest/v1/rpc/match_messages
create or replace function match_messages(
  query_embedding vector(1536),
  match_count int default 10,
  filter_role text default null
)
returns table (
  id         bigint,
  created_at timestamptz,
  role       text,
  content    text,
  similarity float
)
language sql stable as $$
  select m.id, m.created_at, m.role, m.content,
         1 - (m.embedding <=> query_embedding) as similarity
  from messages m
  where m.embedding is not null
    and (filter_role is null or m.role = filter_role)
  order by m.embedding <=> query_embedding
  limit match_count;
$$;
