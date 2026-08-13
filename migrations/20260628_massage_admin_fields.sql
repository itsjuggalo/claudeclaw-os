-- Safe additive migration for Massage Admin account editing.
-- Target database:
--   /home/itsju/web/massage/server/data/massage.sqlite
--
-- Do not run this twice without checking PRAGMA table_info(users); SQLite
-- ADD COLUMN is not idempotent on older runtimes.

BEGIN;

ALTER TABLE users ADD COLUMN admin_notes TEXT;
ALTER TABLE users ADD COLUMN next_visit_free_enhancement TEXT;
ALTER TABLE users ADD COLUMN enhancement_expiration_date TEXT;
ALTER TABLE users ADD COLUMN email_opt_in INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN sms_opt_in INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'active';

CREATE TABLE IF NOT EXISTS admin_action_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_user TEXT NOT NULL,
  client_id TEXT NOT NULL,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  timestamp TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_action_log_client ON admin_action_log(client_id);
CREATE INDEX IF NOT EXISTS idx_admin_action_log_timestamp ON admin_action_log(timestamp);

COMMIT;
