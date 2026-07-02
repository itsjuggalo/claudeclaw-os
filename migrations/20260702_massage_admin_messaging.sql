-- Massage Admin — full-admin build additions (messaging audit).
-- Target database:
--   /home/itsju/web/massage/server/data/massage.sqlite
--
-- Additive + idempotent (CREATE TABLE/INDEX IF NOT EXISTS). Safe to re-run.
-- Records every admin-triggered or automatic nudge/message sent through the
-- Massage Admin console, so sends are auditable alongside admin_action_log.

BEGIN;

CREATE TABLE IF NOT EXISTS admin_messages (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        TEXT,            -- users(id), nullable (may target a raw appointment)
  appointment_id TEXT,            -- appointments(id), nullable
  channel        TEXT NOT NULL,   -- 'email' | 'sms'
  template       TEXT NOT NULL,   -- 'intake_nudge' | 'appointment_reminder' | 'custom' | ...
  recipient      TEXT,            -- email address or phone actually targeted
  subject        TEXT,            -- email subject / sms first line (for the log)
  status         TEXT NOT NULL,   -- 'sent' | 'dry_run' | 'skipped_optout' | 'error'
  detail         TEXT,            -- provider/mode or error message
  admin_user     TEXT NOT NULL,   -- acting admin email (or 'auto:<runner>' for scheduled)
  sent_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_messages_user ON admin_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_messages_sent ON admin_messages(sent_at);

COMMIT;
