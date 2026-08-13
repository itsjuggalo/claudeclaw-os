-- Health OS — initial schema
-- A personal AI health coach's database. Every table serves the owner's health
-- goals (fat loss, muscle retention) or a medical risk tied to them. Example seed
-- values live in 0002_seed_example.sql; replace them with your own.
--
-- Access model: the coach agent talks to this DB with the SERVICE ROLE key
-- (server-side, bypasses RLS). RLS is enabled with NO policies on every table so
-- that the anon/public key can read nothing if it ever leaks. This is sensitive
-- health data, walled off in its own Canada-region project.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists vector;

-- NOTE: the private 'health-assets' storage bucket is created out-of-band via
-- the Storage API (see scripts/setup-storage.sh), not here. On a freshly
-- provisioned project the storage schema may not be reachable from the
-- migration connection yet, so creating it via the API is more reliable.

-- ---------------------------------------------------------------------------
-- Conversation log (every Telegram exchange, both directions)
-- ---------------------------------------------------------------------------
create table messages (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  source      text not null default 'telegram',
  chat_id     text,
  role        text not null check (role in ('user','assistant')),
  command     text,
  content     text not null,
  tags        text[],
  embedding   vector(1536)          -- OpenAI text-embedding-3-small; for semantic recall
);
create index messages_created_at_idx on messages (created_at desc);
create index messages_tags_idx on messages using gin (tags);
-- HNSW needs no training data, unlike ivfflat. Cosine distance for semantic recall.
create index messages_embedding_idx on messages using hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- All media. File lives in Storage; this row points at it + holds analysis
-- ---------------------------------------------------------------------------
create table assets (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  type         text not null check (type in ('body_photo','food','lab_scan','other')),
  storage_path text not null,
  mime_type    text,
  caption      text,
  message_id   bigint references messages(id),
  extracted    jsonb                 -- structured analysis the coach produced
);
create index assets_created_at_idx on assets (created_at desc);
create index assets_type_idx on assets (type);

-- ---------------------------------------------------------------------------
-- Weigh-ins (the weigh-before / weigh-after backbone)
-- ---------------------------------------------------------------------------
create table weigh_ins (
  id           bigint generated always as identity primary key,
  measured_at  timestamptz not null default now(),
  weight_kg    numeric not null,
  body_fat_pct numeric,
  source       text,                  -- 'smart_scale','inbody','manual'
  is_baseline  boolean default false, -- the "before" anchor
  photo_id     bigint references assets(id),
  notes        text
);
create index weigh_ins_measured_at_idx on weigh_ins (measured_at desc);

-- ---------------------------------------------------------------------------
-- Body measurements over time (tape + InBody fields)
-- ---------------------------------------------------------------------------
create table body_measurements (
  id                 bigint generated always as identity primary key,
  measured_at        timestamptz not null default now(),
  waist_cm           numeric,
  hip_cm             numeric,
  chest_cm           numeric,
  arm_cm             numeric,
  visceral_level     numeric,
  skeletal_muscle_kg numeric,
  trunk_fat_kg       numeric,
  source             text,
  notes              text
);
create index body_measurements_measured_at_idx on body_measurements (measured_at desc);

-- ---------------------------------------------------------------------------
-- Food log, with genetics-relevant flags baked in
-- ---------------------------------------------------------------------------
create table food_log (
  id             bigint generated always as identity primary key,
  eaten_at       timestamptz not null default now(),
  meal           text,                -- 'breakfast','lunch','dinner','snack'
  items          text not null,
  est_calories   numeric,
  protein_g      numeric,
  carbs_g        numeric,
  fat_g          numeric,
  sat_fat_flag   boolean,             -- saturated-fat sensitivity flag
  sodium_flag    boolean,             -- sodium / blood-pressure sensitivity flag
  sugar_flag     boolean,             -- glycemic / insulin-sensitivity flag
  location       text,
  photo_id       bigint references assets(id),
  coach_feedback text,
  notes          text
);
create index food_log_eaten_at_idx on food_log (eaten_at desc);

-- ---------------------------------------------------------------------------
-- Workouts (resistance is ~99% of his training)
-- ---------------------------------------------------------------------------
create table workouts (
  id                  bigint generated always as identity primary key,
  performed_at        timestamptz not null default now(),
  type                text,          -- 'resistance','zone2','mobility','other'
  exercises           jsonb,         -- [{name, sets, reps, load_kg}]
  duration_min        numeric,
  perceived_exertion  int,           -- RPE 1-10
  location            text,          -- 'hotel_gym','home','outdoor'
  prescribed_by_coach boolean default false,
  notes               text
);
create index workouts_performed_at_idx on workouts (performed_at desc);

-- ---------------------------------------------------------------------------
-- Supplement adherence (track the decided stack)
-- ---------------------------------------------------------------------------
create table supplements_log (
  id         bigint generated always as identity primary key,
  taken_at   timestamptz not null default now(),
  supplement text not null,          -- 'vitamin_d','zinc','creatine','magnesium',...
  dose       text,
  taken      boolean default true,
  notes      text
);
create index supplements_log_taken_at_idx on supplements_log (taken_at desc);

-- ---------------------------------------------------------------------------
-- Caffeine (cortisol / blood pressure)
-- ---------------------------------------------------------------------------
create table caffeine_log (
  id          bigint generated always as identity primary key,
  consumed_at timestamptz not null default now(),
  source      text,                  -- 'coffee','red_bull','tea'
  caffeine_mg numeric,
  notes       text
);
create index caffeine_log_consumed_at_idx on caffeine_log (consumed_at desc);

-- ---------------------------------------------------------------------------
-- Vitals, especially blood pressure (often the key data gap)
-- ---------------------------------------------------------------------------
create table vitals (
  id          bigint generated always as identity primary key,
  measured_at timestamptz not null default now(),
  metric      text not null,         -- 'bp_systolic','bp_diastolic','resting_hr','sleep_hours'
  value       numeric not null,
  unit        text,
  notes       text
);
create index vitals_measured_at_idx on vitals (measured_at desc);
create index vitals_metric_idx on vitals (metric);

-- ---------------------------------------------------------------------------
-- Lab results over time (track against the compendium baseline + retests)
-- ---------------------------------------------------------------------------
create table lab_results (
  id       bigint generated always as identity primary key,
  drawn_at timestamptz not null,
  marker   text not null,            -- 'ldl','lp_a','vitamin_d','testosterone','homa_ir',...
  value    numeric,
  unit     text,
  flag     text,                     -- 'magenta','orange','yellow','green'
  source   text,
  asset_id bigint references assets(id),
  notes    text
);
create index lab_results_drawn_at_idx on lab_results (drawn_at desc);
create index lab_results_marker_idx on lab_results (marker);

-- ---------------------------------------------------------------------------
-- Daily check-in summary (the scheduled job reads + writes this)
-- ---------------------------------------------------------------------------
create table daily_checkins (
  id              bigint generated always as identity primary key,
  checkin_date    date not null,
  sleep_hours     numeric,
  energy_1_10     int,
  mood            text,
  adherence_notes text,
  coach_summary   text,
  plan_for_today  text
);
create unique index daily_checkins_date_idx on daily_checkins (checkin_date);

-- ---------------------------------------------------------------------------
-- Goals / targets, with progress tracking
-- ---------------------------------------------------------------------------
create table goals (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  metric        text not null,       -- 'body_weight_kg','ldl','vitamin_d','bp'
  start_value   numeric,
  target_value  numeric,
  target_date   date,
  current_value numeric,
  notes         text
);

-- ---------------------------------------------------------------------------
-- Where the user is + how to adapt (drives food advice + job timing)
-- ---------------------------------------------------------------------------
create table context (
  id             bigint generated always as identity primary key,
  effective_from timestamptz not null default now(),
  city           text,               -- e.g. 'Toronto','Lisbon','Tokyo'
  timezone       text,               -- e.g. 'America/Toronto'
  environment    text,               -- 'hotel_buffet','restaurants','home_private_chef'
  private_chef   boolean default false,
  notes          text
);
create index context_effective_from_idx on context (effective_from desc);

-- ---------------------------------------------------------------------------
-- Lock everything down: RLS on, no policies. Service role bypasses RLS;
-- the anon key (if ever leaked) can read nothing.
-- ---------------------------------------------------------------------------
alter table messages          enable row level security;
alter table assets            enable row level security;
alter table weigh_ins         enable row level security;
alter table body_measurements enable row level security;
alter table food_log          enable row level security;
alter table workouts          enable row level security;
alter table supplements_log   enable row level security;
alter table caffeine_log      enable row level security;
alter table vitals            enable row level security;
alter table lab_results       enable row level security;
alter table daily_checkins    enable row level security;
alter table goals             enable row level security;
alter table context           enable row level security;

-- ---------------------------------------------------------------------------
-- Seeds (goals + context) live in 0002_seed_example.sql with placeholder values.
-- Copy it, replace the example numbers with your own targets, labs, location, push.
-- ---------------------------------------------------------------------------
