-- Schéma complet d'Ouiread pour Supabase hébergé. Fichier produit par assembler.mjs : ne pas modifier à la main.

-- ===== init/schema.sql (sans les lignes 1-2) =====


CREATE TABLE public.books (
  user_id uuid NOT NULL,
  book_hash text NOT NULL,
  meta_hash text NULL,
  format text NULL,
  title text NULL,
  source_title text NULL,
  author text NULL,
  "group" text NULL,
  tags text[] NULL,
  created_at timestamp with time zone NULL DEFAULT now(),
  updated_at timestamp with time zone NULL DEFAULT now(),
  deleted_at timestamp with time zone NULL,
  uploaded_at timestamp with time zone NULL,
  synced_at timestamp with time zone NOT NULL DEFAULT now(),
  progress integer[] NULL,
  reading_status text NULL,
  reading_status_updated_at timestamp with time zone NULL,
  cover_hash text NULL,
  cover_updated_at timestamp with time zone NULL,
  group_id text NULL,
  group_name text NULL,
  metadata json NULL,
  CONSTRAINT books_pkey PRIMARY KEY (user_id, book_hash),
  CONSTRAINT books_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);

-- Server-assigned incremental-pull cursor, decoupled from updated_at (the
-- client event time / sort key). A trigger stamps it on every write so a
-- server-resolved merge propagates without reordering the date-read library.
-- See migration 016_add_books_synced_at.sql (issue #4678).
CREATE INDEX idx_books_user_synced ON public.books (user_id, synced_at);

CREATE OR REPLACE FUNCTION public.set_books_synced_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.synced_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER books_set_synced_at
  BEFORE INSERT OR UPDATE ON public.books
  FOR EACH ROW
  EXECUTE FUNCTION public.set_books_synced_at();

ALTER TABLE public.books ENABLE ROW LEVEL SECURITY;
CREATE POLICY select_books ON public.books FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY insert_books ON public.books FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY update_books ON public.books FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY delete_books ON public.books FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE TABLE public.book_configs (
  user_id uuid NOT NULL,
  book_hash text NOT NULL,
  meta_hash text NULL,
  location text NULL,
  xpointer text NULL,
  progress jsonb NULL,
  rsvp_position text NULL,
  search_config jsonb NULL,
  view_settings jsonb NULL,
  created_at timestamp with time zone NULL DEFAULT now(),
  updated_at timestamp with time zone NULL DEFAULT now(),
  deleted_at timestamp with time zone NULL,
  CONSTRAINT book_configs_pkey PRIMARY KEY (user_id, book_hash),
  CONSTRAINT book_configs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);

ALTER TABLE public.book_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY select_book_configs ON public.book_configs FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY insert_book_configs ON public.book_configs FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY update_book_configs ON public.book_configs FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY delete_book_configs ON public.book_configs FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE TABLE public.book_notes (
  user_id uuid NOT NULL,
  book_hash text NOT NULL,
  meta_hash text NULL,
  id text NOT NULL,
  type text NULL,
  cfi text NULL,
  xpointer0 text NULL,
  xpointer1 text NULL,
  text text NULL,
  style text NULL,
  color text NULL,
  note text NULL,
  page integer NULL,
  global boolean NULL,
  created_at timestamp with time zone NULL DEFAULT now(),
  updated_at timestamp with time zone NULL DEFAULT now(),
  deleted_at timestamp with time zone NULL,
  CONSTRAINT book_notes_pkey PRIMARY KEY (user_id, book_hash, id),
  CONSTRAINT book_notes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);

ALTER TABLE public.book_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY select_book_notes ON public.book_notes FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY insert_book_notes ON public.book_notes FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY update_book_notes ON public.book_notes FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY delete_book_notes ON public.book_notes FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE TABLE public.files (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  book_hash text NULL,
  file_key text NOT NULL,
  file_size bigint NOT NULL,
  created_at timestamp with time zone NULL DEFAULT now(),
  updated_at timestamp with time zone NULL DEFAULT now(),
  deleted_at timestamp with time zone NULL,
  CONSTRAINT files_pkey PRIMARY KEY (id),
  CONSTRAINT files_file_key_key UNIQUE (file_key),
  CONSTRAINT files_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);

CREATE INDEX idx_files_user_id_deleted_at ON public.files (user_id, deleted_at);
CREATE INDEX idx_files_file_key ON public.files (file_key);
CREATE INDEX idx_files_file_key_deleted_at ON public.files (file_key, deleted_at);

ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;
CREATE POLICY files_insert ON public.files FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY files_select ON public.files FOR SELECT USING (auth.uid() = user_id AND deleted_at IS NULL);
CREATE POLICY files_update ON public.files FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (deleted_at IS NULL OR deleted_at > now());
CREATE POLICY files_delete ON public.files FOR DELETE USING (auth.uid() = user_id);

GRANT ALL ON public.books TO authenticated;
GRANT ALL ON public.book_configs TO authenticated;
GRANT ALL ON public.book_notes TO authenticated;
GRANT ALL ON public.files TO authenticated;

-- ===== migrations/007_files_replica_grouping.sql =====
-- Migration 007: Per-replica grouping for binaries in `files`.
--
-- Replica-kind binaries (custom dictionary mdx/mdd, font ttf/woff, ...)
-- have no book_hash, so without these columns Storage Manager would
-- lump every replica binary into one "no-book" bucket. Per-replica
-- grouping needs the row to carry the replica's identity alongside
-- file_key/size.

ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS replica_kind text NULL,
  ADD COLUMN IF NOT EXISTS replica_id text NULL;

-- Composite filter index for "list / count files by replica row".
CREATE INDEX IF NOT EXISTS idx_files_replica_lookup
  ON public.files (user_id, replica_kind, replica_id);


-- ===== migrations/014_add_reading_stats.sql =====
-- Migration 014: reading statistics sync (KOReader-compatible page events)

CREATE TABLE IF NOT EXISTS public.stat_books (
  user_id uuid NOT NULL,
  book_hash text NOT NULL,
  title text NOT NULL DEFAULT '',
  authors text NOT NULL DEFAULT '',
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  deleted_at timestamp with time zone NULL,
  CONSTRAINT stat_books_pkey PRIMARY KEY (user_id, book_hash),
  CONSTRAINT stat_books_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_stat_books_user_updated ON public.stat_books (user_id, updated_at);

CREATE TABLE IF NOT EXISTS public.stat_pages (
  user_id uuid NOT NULL,
  book_hash text NOT NULL,
  page integer NOT NULL,
  start_time bigint NOT NULL,
  duration integer NOT NULL DEFAULT 0,
  total_pages integer NOT NULL DEFAULT 0,
  ext jsonb NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  deleted_at timestamp with time zone NULL,
  CONSTRAINT stat_pages_pkey PRIMARY KEY (user_id, book_hash, page, start_time),
  CONSTRAINT stat_pages_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_stat_pages_user_updated ON public.stat_pages (user_id, updated_at);

ALTER TABLE public.stat_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stat_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY stat_books_select ON public.stat_books FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY stat_books_insert ON public.stat_books FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY stat_books_update ON public.stat_books FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY stat_books_delete ON public.stat_books FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE POLICY stat_pages_select ON public.stat_pages FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY stat_pages_insert ON public.stat_pages FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY stat_pages_update ON public.stat_pages FOR UPDATE to authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY stat_pages_delete ON public.stat_pages FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);


-- ===== migrations/003_add_replicas.sql =====
-- Migration 003: Add replicas table for cross-device sync of user-imported assets
-- (dictionaries, fonts, textures, OPDS catalogs, dict settings — gated by
--  a per-kind allowlist enforced both in DB CHECK and in server validation).
-- See ~/.claude/plans/vivid-orbiting-thimble.md and
-- src/libs/crdt.README.md for the design.

-- ─────────────────────────────────────────────────────────────────────────
-- replica_keys: per-account PBKDF2 salt for the encrypted-fields envelope.
-- One row per (user_id, alg). A passphrase rotation appends a new row;
-- forgot-passphrase deletes all rows for the user (and the migrate-time
-- check on encrypted envelopes makes them unreadable client-side).
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.replica_keys (
  user_id uuid NOT NULL,
  salt_id text NOT NULL,
  alg text NOT NULL,
  salt bytea NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT replica_keys_pkey PRIMARY KEY (user_id, salt_id),
  CONSTRAINT replica_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);

ALTER TABLE public.replica_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY replica_keys_select ON public.replica_keys
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY replica_keys_insert ON public.replica_keys
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY replica_keys_delete ON public.replica_keys
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- replicas: polymorphic per-user CRDT-backed metadata.
--   kind            — server-allowlisted: 'dictionary' in PR 1; future kinds
--                     require a server release that updates the CHECK below.
--   fields_jsonb    — per-field LWW envelope: {<field>: {v, t: <Hlc>, s}}
--                     PR-validated 64 KiB / 64-field caps server-side.
--   manifest_jsonb  — committed last after binary upload completes.
--                     null = "binaries pending"; row not yet downloadable.
--   deleted_at_ts   — remove-wins tombstone HLC. A field write does NOT
--                     revive a tombstoned row.
--   reincarnation   — explicit re-import token; swaps row to alive under a
--                     new logical identity.
--   updated_at_ts   — max(field HLCs, deleted_at_ts, row-level operation
--                     HLCs such as manifest commits). Used as the pull cursor.
--   schema_version  — per-kind schema bump; server enforces bounds.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.replicas (
  user_id uuid NOT NULL,
  kind text NOT NULL,
  replica_id text NOT NULL,
  fields_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb,
  manifest_jsonb jsonb NULL,
  deleted_at_ts text NULL,
  reincarnation text NULL,
  updated_at_ts text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  modified_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT replicas_pkey PRIMARY KEY (user_id, kind, replica_id),
  CONSTRAINT replicas_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  -- Server allowlist for kind. Adding a new kind = a coordinated client +
  -- server PR; this CHECK is part of the server release.
  CONSTRAINT replicas_kind_allowlist CHECK (kind IN ('dictionary')),
  -- Hard caps. validateRow() in src/libs/replica-schemas.ts enforces the
  -- same bounds at the API layer with a clearer error code; these CHECKs
  -- are belt-and-suspenders for direct DB writes.
  CONSTRAINT replicas_fields_size CHECK (pg_column_size(fields_jsonb) <= 65536),
  CONSTRAINT replicas_schema_version CHECK (schema_version >= 1 AND schema_version <= 1000)
);

CREATE INDEX IF NOT EXISTS idx_replicas_pull_cursor
  ON public.replicas (user_id, kind, updated_at_ts);

ALTER TABLE public.replicas ENABLE ROW LEVEL SECURITY;

CREATE POLICY replicas_select ON public.replicas
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY replicas_insert ON public.replicas
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY replicas_update ON public.replicas
  FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY replicas_delete ON public.replicas
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);


-- ===== migrations/004_crdt_merge_replica_fn.sql =====
-- Migration 004: crdt_merge_replica() — atomic CRDT merge for the replicas
-- table. Mirrors src/libs/crdt.ts mergeReplica() so client and server
-- converge on identical merge results.
--
-- Properties (verified by tests in src/__tests__/libs/crdt.test.ts and
-- the server-merge race test):
--   * commutative, associative, idempotent on fields_jsonb
--   * remove-wins: a field write never revives a tombstone (deleted_at_ts
--     stays the larger of the two sides)
--   * preserves unknown fields from either side (forwards-compat across
--     schemaVersion bumps)
--   * deviceId tiebreak when two field envelopes share the same HLC
--
-- Called via INSERT … ON CONFLICT … DO UPDATE in a single SQL statement
-- so two concurrent pushes can't interleave fetch-then-upsert. RUNS AS
-- SECURITY INVOKER (default) — the surrounding INSERT/UPDATE is RLS-
-- gated, so we don't need DEFINER. The server endpoint additionally
-- asserts auth.uid() = NEW.user_id before invoking the upsert.

-- ─────────────────────────────────────────────────────────────────────────
-- HLC max helper. NULLs lose. Plain text comparison since the HLC packing
-- format makes lexicographic order match temporal order.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hlc_max(a text, b text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN a IS NULL THEN b
    WHEN b IS NULL THEN a
    WHEN a >= b THEN a
    ELSE b
  END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Field-level LWW merge for fields_jsonb. Per-key: keep the envelope with
-- the larger envelope.t (HLC string). Tie on HLC: deviceId (envelope.s)
-- lex-order tiebreak. Preserves keys present on either side.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crdt_merge_fields(local_fields jsonb, remote_fields jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
AS $$
DECLARE
  result jsonb := COALESCE(local_fields, '{}'::jsonb);
  k text;
  l_env jsonb;
  r_env jsonb;
  l_t text;
  r_t text;
  l_s text;
  r_s text;
BEGIN
  IF remote_fields IS NULL THEN
    RETURN result;
  END IF;
  FOR k IN SELECT jsonb_object_keys(remote_fields) LOOP
    r_env := remote_fields -> k;
    l_env := result -> k;
    IF l_env IS NULL THEN
      result := jsonb_set(result, ARRAY[k], r_env, true);
    ELSE
      l_t := l_env ->> 't';
      r_t := r_env ->> 't';
      IF r_t > l_t THEN
        result := jsonb_set(result, ARRAY[k], r_env, true);
      ELSIF r_t = l_t THEN
        l_s := COALESCE(l_env ->> 's', '');
        r_s := COALESCE(r_env ->> 's', '');
        IF r_s > l_s THEN
          result := jsonb_set(result, ARRAY[k], r_env, true);
        END IF;
      END IF;
    END IF;
  END LOOP;
  RETURN result;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Content updated_at_ts = max over field HLCs and tombstone HLC.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crdt_compute_updated_at(fields jsonb, deleted_at text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
AS $$
DECLARE
  result text := COALESCE(deleted_at, '0000000000000-00000000-');
  k text;
  env jsonb;
  t text;
BEGIN
  IF fields IS NULL THEN
    RETURN result;
  END IF;
  FOR k IN SELECT jsonb_object_keys(fields) LOOP
    env := fields -> k;
    t := env ->> 't';
    IF t IS NOT NULL AND t > result THEN
      result := t;
    END IF;
  END LOOP;
  RETURN result;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Full row merge. Used in:
--   INSERT INTO replicas (...) VALUES (...)
--   ON CONFLICT (user_id, kind, replica_id) DO UPDATE SET
--     fields_jsonb   = crdt_merge_fields(replicas.fields_jsonb, EXCLUDED.fields_jsonb),
--     deleted_at_ts  = hlc_max(replicas.deleted_at_ts, EXCLUDED.deleted_at_ts),
--     reincarnation  = CASE WHEN replicas.reincarnation = EXCLUDED.reincarnation
--                           THEN replicas.reincarnation
--                           WHEN EXCLUDED.updated_at_ts > replicas.updated_at_ts
--                           THEN EXCLUDED.reincarnation
--                           ELSE replicas.reincarnation END,
--     manifest_jsonb = CASE WHEN EXCLUDED.updated_at_ts > replicas.updated_at_ts
--                           THEN EXCLUDED.manifest_jsonb
--                           ELSE replicas.manifest_jsonb END,
--     schema_version = GREATEST(replicas.schema_version, EXCLUDED.schema_version),
--     updated_at_ts  = crdt_compute_updated_at(
--                        crdt_merge_fields(replicas.fields_jsonb, EXCLUDED.fields_jsonb),
--                        hlc_max(replicas.deleted_at_ts, EXCLUDED.deleted_at_ts)
--                      ),
--     modified_at    = now()
--
-- Or via the wrapper below for shorter call sites.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crdt_merge_replica(
  p_user_id uuid,
  p_kind text,
  p_replica_id text,
  p_fields_jsonb jsonb,
  p_manifest_jsonb jsonb,
  p_deleted_at_ts text,
  p_reincarnation text,
  p_updated_at_ts text,
  p_schema_version integer
) RETURNS public.replicas
LANGUAGE plpgsql
AS $$
DECLARE
  result public.replicas;
BEGIN
  INSERT INTO public.replicas AS r (
    user_id, kind, replica_id,
    fields_jsonb, manifest_jsonb, deleted_at_ts,
    reincarnation, updated_at_ts, schema_version
  ) VALUES (
    p_user_id, p_kind, p_replica_id,
    COALESCE(p_fields_jsonb, '{}'::jsonb),
    p_manifest_jsonb, p_deleted_at_ts,
    p_reincarnation, p_updated_at_ts, p_schema_version
  )
  ON CONFLICT (user_id, kind, replica_id) DO UPDATE SET
    fields_jsonb   = public.crdt_merge_fields(r.fields_jsonb, EXCLUDED.fields_jsonb),
    deleted_at_ts  = public.hlc_max(r.deleted_at_ts, EXCLUDED.deleted_at_ts),
    reincarnation  = CASE
                       WHEN r.reincarnation IS NOT DISTINCT FROM EXCLUDED.reincarnation
                         THEN r.reincarnation
                       WHEN EXCLUDED.updated_at_ts > r.updated_at_ts
                         THEN EXCLUDED.reincarnation
                       ELSE r.reincarnation
                     END,
    manifest_jsonb = CASE
                       WHEN EXCLUDED.updated_at_ts > r.updated_at_ts
                         THEN EXCLUDED.manifest_jsonb
                       ELSE r.manifest_jsonb
                     END,
    schema_version = GREATEST(r.schema_version, EXCLUDED.schema_version),
    updated_at_ts  = public.crdt_compute_updated_at(
                       public.crdt_merge_fields(r.fields_jsonb, EXCLUDED.fields_jsonb),
                       public.hlc_max(r.deleted_at_ts, EXCLUDED.deleted_at_ts)
                     ),
    modified_at    = now()
  RETURNING * INTO result;
  RETURN result;
END;
$$;

-- Surface the function to the API role only after an explicit user-id
-- match check in src/pages/api/sync/replicas.ts. RLS on the replicas
-- table is the second line of defense (the function runs as caller).
GRANT EXECUTE ON FUNCTION public.hlc_max(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crdt_merge_fields(jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crdt_compute_updated_at(jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crdt_merge_replica(uuid, text, text, jsonb, jsonb, text, text, text, integer) TO authenticated;


-- ===== migrations/005_replica_manifest_cursor_updated_at.sql =====
-- Migration 005: keep replica updated_at_ts as the max row-operation HLC.
--
-- Migration 004 recomputed updated_at_ts from fields_jsonb + deleted_at_ts
-- after every conflict. That loses manifest-only operation timestamps:
-- manifest_jsonb can change, but pull cursors do not advance, so a device
-- that already pulled the metadata-only row can miss the downloadable
-- transition. Preserve the max of existing row timestamp, incoming row
-- timestamp, and content/tombstone timestamp.
--
-- Also treat incoming manifest_jsonb = null as "no manifest update" on
-- conflict. Metadata-only rows use null, and must not clear an existing
-- committed manifest.
--
-- Reincarnation is derived from the newest non-null token candidate that
-- is newer than the merged tombstone. Null metadata/manifest rows do not
-- clear a token; a newer tombstone clears it because no token candidate is
-- newer than that tombstone. Without this, editing a reincarnated
-- dictionary title publishes p_reincarnation = null and erases the revival
-- token.

CREATE OR REPLACE FUNCTION public.crdt_merge_replica(
  p_user_id uuid,
  p_kind text,
  p_replica_id text,
  p_fields_jsonb jsonb,
  p_manifest_jsonb jsonb,
  p_deleted_at_ts text,
  p_reincarnation text,
  p_updated_at_ts text,
  p_schema_version integer
) RETURNS public.replicas
LANGUAGE plpgsql
AS $$
DECLARE
  result public.replicas;
BEGIN
  INSERT INTO public.replicas AS r (
    user_id, kind, replica_id,
    fields_jsonb, manifest_jsonb, deleted_at_ts,
    reincarnation, updated_at_ts, schema_version
  ) VALUES (
    p_user_id, p_kind, p_replica_id,
    COALESCE(p_fields_jsonb, '{}'::jsonb),
    p_manifest_jsonb, p_deleted_at_ts,
    p_reincarnation, p_updated_at_ts, p_schema_version
  )
  ON CONFLICT (user_id, kind, replica_id) DO UPDATE SET
    fields_jsonb   = public.crdt_merge_fields(r.fields_jsonb, EXCLUDED.fields_jsonb),
    deleted_at_ts  = public.hlc_max(r.deleted_at_ts, EXCLUDED.deleted_at_ts),
    reincarnation  = CASE
                       WHEN r.reincarnation IS NULL AND EXCLUDED.reincarnation IS NULL
                         THEN NULL
                       WHEN r.reincarnation IS NOT NULL AND EXCLUDED.reincarnation IS NULL
                         THEN CASE
                                WHEN public.hlc_max(r.deleted_at_ts, EXCLUDED.deleted_at_ts) IS NULL
                                  OR r.updated_at_ts > public.hlc_max(r.deleted_at_ts, EXCLUDED.deleted_at_ts)
                                  THEN r.reincarnation
                                ELSE NULL
                              END
                       WHEN r.reincarnation IS NULL AND EXCLUDED.reincarnation IS NOT NULL
                         THEN CASE
                                WHEN public.hlc_max(r.deleted_at_ts, EXCLUDED.deleted_at_ts) IS NULL
                                  OR EXCLUDED.updated_at_ts > public.hlc_max(r.deleted_at_ts, EXCLUDED.deleted_at_ts)
                                  THEN EXCLUDED.reincarnation
                                ELSE NULL
                              END
                       WHEN EXCLUDED.updated_at_ts > r.updated_at_ts
                         THEN CASE
                                WHEN public.hlc_max(r.deleted_at_ts, EXCLUDED.deleted_at_ts) IS NULL
                                  OR EXCLUDED.updated_at_ts > public.hlc_max(r.deleted_at_ts, EXCLUDED.deleted_at_ts)
                                  THEN EXCLUDED.reincarnation
                                ELSE NULL
                              END
                       ELSE CASE
                              WHEN public.hlc_max(r.deleted_at_ts, EXCLUDED.deleted_at_ts) IS NULL
                                OR r.updated_at_ts > public.hlc_max(r.deleted_at_ts, EXCLUDED.deleted_at_ts)
                                THEN r.reincarnation
                              ELSE NULL
                            END
                     END,
    manifest_jsonb = CASE
                       WHEN EXCLUDED.manifest_jsonb IS NULL
                         THEN r.manifest_jsonb
                       WHEN r.manifest_jsonb IS NULL
                         THEN EXCLUDED.manifest_jsonb
                       WHEN EXCLUDED.updated_at_ts > r.updated_at_ts
                         THEN EXCLUDED.manifest_jsonb
                       ELSE r.manifest_jsonb
                     END,
    schema_version = GREATEST(r.schema_version, EXCLUDED.schema_version),
    updated_at_ts  = public.hlc_max(
                       public.hlc_max(r.updated_at_ts, EXCLUDED.updated_at_ts),
                       public.crdt_compute_updated_at(
                         public.crdt_merge_fields(r.fields_jsonb, EXCLUDED.fields_jsonb),
                         public.hlc_max(r.deleted_at_ts, EXCLUDED.deleted_at_ts)
                       )
                     ),
    modified_at    = now()
  RETURNING * INTO result;
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.crdt_merge_replica(uuid, text, text, jsonb, jsonb, text, text, text, integer) TO authenticated;


-- ===== migrations/006_replica_more_kinds.sql =====
-- Migration 006: Extend the replicas.kind allowlist beyond 'dictionary'.
-- Pre-allows the kinds we plan to ship in upcoming client releases so
-- each adapter only needs a coordinated client + server-validation
-- update, not another DB migration. The DB CHECK is belt-and-
-- suspenders; src/libs/replicaSchemas.ts (KIND_ALLOWLIST) is the
-- actual gate that decides which kinds the server accepts on push.

ALTER TABLE public.replicas
  DROP CONSTRAINT IF EXISTS replicas_kind_allowlist;

ALTER TABLE public.replicas
  ADD CONSTRAINT replicas_kind_allowlist
  CHECK (kind IN ('dictionary', 'font', 'texture'));


-- ===== migrations/008_replica_keys_rpcs.sql =====
-- Migration 008: RPC helpers for the replica_keys table.
-- The bytea salt round-trips as base64 over PostgREST so the client never
-- has to deal with Postgres hex encoding. Both functions run SECURITY
-- INVOKER, so the table's RLS policies (created in migration 003) enforce
-- the auth.uid() = user_id guard.

-- gen_random_bytes() lives in pgcrypto; Supabase enables it by default,
-- but we make the dependency explicit so a fresh self-hosted database
-- works on first apply.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.replica_keys_create(p_alg text)
RETURNS TABLE(salt_id text, alg text, salt_b64 text, created_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_salt_id text := gen_random_uuid()::text;
  v_salt bytea := extensions.gen_random_bytes(32);
BEGIN
  IF p_alg <> 'pbkdf2-600k-sha256' THEN
    RAISE EXCEPTION 'Unsupported alg: %', p_alg USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.replica_keys (user_id, salt_id, alg, salt)
  VALUES (auth.uid(), v_salt_id, p_alg, v_salt);
  RETURN QUERY
    SELECT v_salt_id, p_alg, encode(v_salt, 'base64'), now();
END;
$$;

CREATE OR REPLACE FUNCTION public.replica_keys_list()
RETURNS TABLE(salt_id text, alg text, salt_b64 text, created_at timestamptz)
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
  SELECT salt_id, alg, encode(salt, 'base64') AS salt_b64, created_at
  FROM public.replica_keys
  WHERE user_id = (SELECT auth.uid())
  ORDER BY created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.replica_keys_create(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replica_keys_list() TO authenticated;


-- ===== migrations/009_replica_opds_catalog.sql =====
-- Migration 009: Extend the replicas.kind allowlist with 'opds_catalog'.
-- The DB CHECK is belt-and-suspenders; src/libs/replicaSchemas.ts
-- (KIND_ALLOWLIST) is the actual gate that decides which kinds the
-- server accepts on push.

ALTER TABLE public.replicas
  DROP CONSTRAINT IF EXISTS replicas_kind_allowlist;

ALTER TABLE public.replicas
  ADD CONSTRAINT replicas_kind_allowlist
  CHECK (kind IN ('dictionary', 'font', 'texture', 'opds_catalog'));


-- ===== migrations/010_replica_keys_forget.sql =====
-- Migration 010: replica_keys_forget RPC.
-- Wipes every encrypted-field envelope from the user's replica rows
-- (any field whose `v` slot contains a cipher envelope, identified by
-- the `alg` key) and deletes every replica_keys row for the user. The
-- next encrypted push from any device will mint a fresh salt + key.
--
-- Plaintext fields are untouched. Local plaintext copies on each
-- device survive — the user just has to re-enter their sync passphrase
-- on each device and the encrypted fields will be re-encrypted under
-- the new key on the next push.
--
-- SECURITY INVOKER: RLS on replicas + replica_keys gates the writes
-- to the calling user's rows.

CREATE OR REPLACE FUNCTION public.replica_keys_forget()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'replica_keys_forget called without an authenticated user';
  END IF;

  -- Strip cipher envelopes from each row's fields_jsonb. A cipher
  -- envelope is the value of a field's `v` slot when that value is an
  -- object containing the `alg` key (per CipherEnvelope shape:
  -- {c, i, s, alg, h}). Plain field envelopes have a non-object `v`.
  UPDATE public.replicas r
  SET fields_jsonb = (
    SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)
    FROM jsonb_each(r.fields_jsonb)
    WHERE NOT (
      jsonb_typeof(value -> 'v') = 'object'
      AND value -> 'v' ? 'alg'
    )
  )
  WHERE r.user_id = v_user_id
    AND EXISTS (
      SELECT 1 FROM jsonb_each(r.fields_jsonb) e
      WHERE jsonb_typeof(e.value -> 'v') = 'object'
        AND e.value -> 'v' ? 'alg'
    );

  -- Drop every salt row. The next encrypted push will create a fresh
  -- one via replica_keys_create.
  DELETE FROM public.replica_keys WHERE user_id = v_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.replica_keys_forget() TO authenticated;


-- ===== migrations/011_replica_settings.sql =====
-- Migration 011: Extend the replicas.kind allowlist with 'settings'.
-- Per tenet 8 of the replica-sync plan, scalar settings sync via a
-- single bundled row keyed by ('settings', 'singleton') instead of N
-- per-kind adapters. The DB CHECK is belt-and-suspenders;
-- src/libs/replicaSchemas.ts (KIND_ALLOWLIST) is the actual gate.

ALTER TABLE public.replicas
  DROP CONSTRAINT IF EXISTS replicas_kind_allowlist;

ALTER TABLE public.replicas
  ADD CONSTRAINT replicas_kind_allowlist
  CHECK (kind IN ('dictionary', 'font', 'texture', 'opds_catalog', 'settings'));


-- ===== ouiread/ouiread-extras.sql =====

-- ============================================================
-- Ouiread : compléments pour un projet Supabase hébergé.
-- À exécuter après le schéma de base et ses migrations
-- (voir assembler.mjs, qui produit ouiread-hosted.sql).
-- ============================================================

-- 1. Une ligne « plans » par lecteur : sa formule, le stockage acheté,
--    et la date à laquelle il a reçu le livre offert à l'inscription.
CREATE TABLE IF NOT EXISTS public.plans (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  user_id uuid GENERATED ALWAYS AS (id) STORED,
  plan text NOT NULL DEFAULT 'free',
  status text NOT NULL DEFAULT 'active',
  storage_purchased_bytes bigint NOT NULL DEFAULT 0,
  welcome_gift_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS select_own_plan ON public.plans;
CREATE POLICY select_own_plan ON public.plans
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = id);

-- Écoute des voix premium sans plafond mensuel (le compte du propriétaire,
-- pour le classement des lecteurs). Posée à la main dans la base, jamais par
-- l'appli : aucune politique n'ouvre l'écriture de plans aux lecteurs.
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS voice_unlimited boolean NOT NULL DEFAULT false;

-- La ligne est créée en même temps que le compte.
CREATE OR REPLACE FUNCTION public.ouiread_handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.plans (id) VALUES (NEW.id) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ouiread_on_auth_user_created ON auth.users;
CREATE TRIGGER ouiread_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.ouiread_handle_new_user();

-- 2. Jeton d'accès enrichi. L'appli lit trois informations dans le jeton
--    (src/utils/access.ts) : la formule, l'espace utilisé et l'espace acheté.
--    À activer dans Authentication > Hooks > « Customize Access Token (JWT) Claims ».
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  claims jsonb := event -> 'claims';
  v_uid uuid := (event ->> 'user_id')::uuid;
  v_plan text;
  v_purchased bigint;
  v_usage bigint;
BEGIN
  SELECT p.plan, p.storage_purchased_bytes INTO v_plan, v_purchased
    FROM public.plans p WHERE p.id = v_uid;
  SELECT COALESCE(SUM(f.file_size), 0) INTO v_usage
    FROM public.files f WHERE f.user_id = v_uid AND f.deleted_at IS NULL;

  claims := jsonb_set(claims, '{plan}', to_jsonb(COALESCE(v_plan, 'free')));
  claims := jsonb_set(claims, '{storage_usage_bytes}', to_jsonb(COALESCE(v_usage, 0)));
  claims := jsonb_set(claims, '{storage_purchased_bytes}', to_jsonb(COALESCE(v_purchased, 0)));
  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;
GRANT SELECT ON public.plans TO supabase_auth_admin;
GRANT SELECT ON public.files TO supabase_auth_admin;

DROP POLICY IF EXISTS auth_admin_read_plans ON public.plans;
CREATE POLICY auth_admin_read_plans ON public.plans
  FOR SELECT TO supabase_auth_admin USING (true);
DROP POLICY IF EXISTS auth_admin_read_files ON public.files;
CREATE POLICY auth_admin_read_files ON public.files
  FOR SELECT TO supabase_auth_admin USING (true);

-- Stockage : seul le serveur écrit la table files (routes storage/*, livre
-- offert). Avant, un lecteur pouvait changer la taille de ses fichiers
-- (file_size = 0) et remettre son compteur de stockage à zéro.
REVOKE INSERT, UPDATE, DELETE ON public.files FROM anon, authenticated;
ALTER TABLE public.files DROP CONSTRAINT IF EXISTS files_size_not_negative;
ALTER TABLE public.files ADD CONSTRAINT files_size_not_negative CHECK (file_size >= 0);

-- Stockage réellement utilisé, lu par la route d'envoi (le jeton peut avoir
-- une heure de retard). Réservé au serveur.
CREATE OR REPLACE FUNCTION public.ouiread_storage_usage(p_user_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(SUM(file_size), 0)::bigint
    FROM public.files
   WHERE user_id = p_user_id AND deleted_at IS NULL;
$$;
REVOKE ALL ON FUNCTION public.ouiread_storage_usage(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ouiread_storage_usage(uuid) TO service_role;

-- La fonction du déclencheur de création de compte n'a pas à être appelable
-- de l'extérieur (alerte du Security Advisor de Supabase).
REVOKE EXECUTE ON FUNCTION public.ouiread_handle_new_user() FROM PUBLIC, anon, authenticated;
