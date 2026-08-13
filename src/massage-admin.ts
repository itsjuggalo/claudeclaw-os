import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';

const MASSAGE_DB_PATH =
  process.env.MASSAGE_DB_PATH || '/home/itsju/web/massage/server/data/massage.sqlite';
const BACKUP_DIR =
  process.env.MASSAGE_ADMIN_BACKUP_DIR || '/home/itsju/backups/db-moderation/massage-admin';

const USER_ADMIN_COLUMNS = [
  'admin_notes',
  'next_visit_free_enhancement',
  'enhancement_expiration_date',
  'email_opt_in',
  'sms_opt_in',
  'account_status',
] as const;

const ADMIN_LOG_TABLE = 'admin_action_log';
const ACCOUNT_STATUS_VALUES = new Set(['active', 'inactive', 'archived', 'blocked']);

export interface MassageAdminMigrationState {
  required: boolean;
  missingUserColumns: string[];
  missingTables: string[];
  sqlFile: string;
}

export interface MassageAdminClient {
  id: string;
  name: string;
  phone: string;
  email: string;
  notes: string;
  nextVisitFreeEnhancement: string;
  enhancementExpirationDate: string;
  emailOptIn: boolean;
  smsOptIn: boolean;
  accountStatus: string;
  createdAt: string;
  emailVerifiedAt: string | null;
  appointmentCount: number;
  upcomingAppointmentCount: number;
  rewardBalance: number;
  lastVisitMs: number | null;
}

export interface MassageAdminAction {
  id: number;
  adminUser: string;
  clientId: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  timestamp: string;
}

export interface MassageAdminOverview {
  dbPath: string;
  migration: MassageAdminMigrationState;
  clients: MassageAdminClient[];
  actionLog: MassageAdminAction[];
}

export interface MassageAdminUpdateInput {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  notes?: unknown;
  nextVisitFreeEnhancement?: unknown;
  enhancementExpirationDate?: unknown;
  emailOptIn?: unknown;
  smsOptIn?: unknown;
  accountStatus?: unknown;
}

function openDb(readonly: boolean): Database.Database {
  if (!existsSync(MASSAGE_DB_PATH)) throw new Error(`massage database not found: ${MASSAGE_DB_PATH}`);
  const db = new Database(MASSAGE_DB_PATH, { readonly });
  db.pragma('busy_timeout = 5000');
  return db;
}

function tableExists(db: Database.Database, table: string): boolean {
  const row = db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?").get(table);
  return Boolean(row);
}

function columnSet(db: Database.Database, table: string): Set<string> {
  if (!tableExists(db, table)) return new Set();
  const rows = db.prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

function migrationState(db: Database.Database): MassageAdminMigrationState {
  const userColumns = columnSet(db, 'users');
  const missingUserColumns = USER_ADMIN_COLUMNS.filter((column) => !userColumns.has(column));
  const missingTables = tableExists(db, ADMIN_LOG_TABLE) ? [] : [ADMIN_LOG_TABLE];
  return {
    required: missingUserColumns.length > 0 || missingTables.length > 0,
    missingUserColumns,
    missingTables,
    sqlFile: 'migrations/20260628_massage_admin_fields.sql',
  };
}

const readExpr = (columns: Set<string>, column: string, fallback: string) =>
  columns.has(column) ? `u.${column}` : `${fallback} AS ${column}`;

function rowToClient(row: Record<string, unknown>): MassageAdminClient {
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    phone: String(row.phone ?? ''),
    email: String(row.email ?? ''),
    notes: String(row.admin_notes ?? ''),
    nextVisitFreeEnhancement: String(row.next_visit_free_enhancement ?? ''),
    enhancementExpirationDate: String(row.enhancement_expiration_date ?? ''),
    emailOptIn: Number(row.email_opt_in ?? 0) === 1,
    smsOptIn: Number(row.sms_opt_in ?? 0) === 1,
    accountStatus: String(row.account_status ?? 'active') || 'active',
    createdAt: String(row.created_at ?? ''),
    emailVerifiedAt: row.email_verified_at == null ? null : String(row.email_verified_at),
    appointmentCount: Number(row.appointment_count ?? 0),
    upcomingAppointmentCount: Number(row.upcoming_appointment_count ?? 0),
    rewardBalance: Number(row.reward_balance ?? 0),
    lastVisitMs: row.last_visit_ms == null ? null : Number(row.last_visit_ms),
  };
}

// reward_ledger / last-visit are optional (tables may pre-date rewards); guard so a
// fresh DB without reward_ledger never breaks the overview read.
function hasTable(db: Database.Database, table: string): boolean {
  return tableExists(db, table);
}

function listClients(db: Database.Database): MassageAdminClient[] {
  const columns = columnSet(db, 'users');
  const hasRewards = hasTable(db, 'reward_ledger');
  const rewardExpr = hasRewards
    ? '(SELECT COALESCE(SUM(r.delta),0) FROM reward_ledger r WHERE r.user_id = u.id)'
    : '0';
  const rows = db.prepare(`
    SELECT
      u.id,
      u.name,
      u.phone,
      u.email,
      u.created_at,
      u.email_verified_at,
      ${readExpr(columns, 'admin_notes', "''")},
      ${readExpr(columns, 'next_visit_free_enhancement', "''")},
      ${readExpr(columns, 'enhancement_expiration_date', "''")},
      ${readExpr(columns, 'email_opt_in', '0')},
      ${readExpr(columns, 'sms_opt_in', '0')},
      ${readExpr(columns, 'account_status', "'active'")},
      (SELECT COUNT(*) FROM appointments a WHERE a.user_id = u.id OR lower(a.client_email) = lower(u.email)) AS appointment_count,
      (SELECT COUNT(*) FROM appointments a WHERE (a.user_id = u.id OR lower(a.client_email) = lower(u.email)) AND a.start_ms > ?) AS upcoming_appointment_count,
      ${rewardExpr} AS reward_balance,
      (SELECT MAX(a.start_ms) FROM appointments a WHERE (a.user_id = u.id OR lower(a.client_email) = lower(u.email)) AND a.start_ms < ? AND a.status IN ('confirmed','completed')) AS last_visit_ms
    FROM users u
    ORDER BY COALESCE(u.name, u.email) COLLATE NOCASE
  `).all(Date.now(), Date.now()) as Array<Record<string, unknown>>;
  return rows.map(rowToClient);
}

function listActions(db: Database.Database, limit = 50): MassageAdminAction[] {
  if (!tableExists(db, ADMIN_LOG_TABLE)) return [];
  const rows = db.prepare(`
    SELECT id, admin_user, client_id, field, old_value, new_value, timestamp
    FROM admin_action_log
    ORDER BY id DESC
    LIMIT ?
  `).all(Math.max(1, Math.min(200, limit))) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: Number(row.id),
    adminUser: String(row.admin_user ?? ''),
    clientId: String(row.client_id ?? ''),
    field: String(row.field ?? ''),
    oldValue: row.old_value == null ? null : String(row.old_value),
    newValue: row.new_value == null ? null : String(row.new_value),
    timestamp: String(row.timestamp ?? ''),
  }));
}

export function getMassageAdminOverview(): MassageAdminOverview {
  const db = openDb(true);
  try {
    return {
      dbPath: MASSAGE_DB_PATH,
      migration: migrationState(db),
      clients: listClients(db),
      actionLog: listActions(db),
    };
  } finally {
    db.close();
  }
}

const toText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();

const toBoolInt = (value: unknown): number =>
  value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0;

function normalizeUpdate(input: MassageAdminUpdateInput): Record<string, string | number> {
  const email = toText(input.email).toLowerCase();
  if (!email || !email.includes('@')) throw new Error('valid email is required');
  const accountStatus = toText(input.accountStatus || 'active') || 'active';
  if (!ACCOUNT_STATUS_VALUES.has(accountStatus)) throw new Error(`invalid account status: ${accountStatus}`);

  return {
    name: toText(input.name),
    phone: toText(input.phone),
    email,
    admin_notes: toText(input.notes),
    next_visit_free_enhancement: toText(input.nextVisitFreeEnhancement),
    enhancement_expiration_date: toText(input.enhancementExpirationDate),
    email_opt_in: toBoolInt(input.emailOptIn),
    sms_opt_in: toBoolInt(input.smsOptIn),
    account_status: accountStatus,
  };
}

function backupBeforeWrite(db: Database.Database): string {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = `${BACKUP_DIR}/${stamp}.sqlite`;
  try {
    copyFileSync(MASSAGE_DB_PATH, dest);
    if (existsSync(`${MASSAGE_DB_PATH}-wal`)) copyFileSync(`${MASSAGE_DB_PATH}-wal`, `${dest}-wal`);
  } catch {
    void db.backup(dest).catch(() => {});
  }
  return dest;
}

function stringifyAuditValue(value: unknown): string | null {
  if (value == null) return null;
  return String(value);
}

export function updateMassageAdminClient(
  clientId: string,
  input: MassageAdminUpdateInput,
  adminUser: string,
): { ok: true; client: MassageAdminClient; changed: number; backupPath: string } | { error: string; migration?: MassageAdminMigrationState } {
  const id = toText(clientId);
  if (!id) return { error: 'client id is required' };

  const db = openDb(false);
  try {
    const migration = migrationState(db);
    if (migration.required) return { error: 'massage admin migration is required before editing', migration };

    const next = normalizeUpdate(input);
    const before = db.prepare('SELECT * FROM users WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!before) return { error: 'client not found' };

    const changed = Object.entries(next).filter(([column, value]) => String(before[column] ?? '') !== String(value ?? ''));
    if (changed.length === 0) {
      const current = db.prepare(`
        SELECT
          u.*,
          (SELECT COUNT(*) FROM appointments a WHERE a.user_id = u.id OR lower(a.client_email) = lower(u.email)) AS appointment_count,
          (SELECT COUNT(*) FROM appointments a WHERE (a.user_id = u.id OR lower(a.client_email) = lower(u.email)) AND a.start_ms > ?) AS upcoming_appointment_count
        FROM users u
        WHERE u.id=?
      `).get(Date.now(), id) as Record<string, unknown>;
      return {
        ok: true,
        client: rowToClient(current),
        changed: 0,
        backupPath: '',
      };
    }

    const backupPath = backupBeforeWrite(db);
    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      const setSql = changed.map(([column]) => `"${column.replace(/"/g, '""')}" = @${column}`).join(', ');
      db.prepare(`UPDATE users SET ${setSql} WHERE id = @id`).run({ ...next, id });
      const log = db.prepare(`
        INSERT INTO admin_action_log (admin_user, client_id, field, old_value, new_value, timestamp)
        VALUES (@admin_user, @client_id, @field, @old_value, @new_value, @timestamp)
      `);
      for (const [column, value] of changed) {
        log.run({
          admin_user: adminUser,
          client_id: id,
          field: column,
          old_value: stringifyAuditValue(before[column]),
          new_value: stringifyAuditValue(value),
          timestamp: now,
        });
      }
    });
    tx();

    const after = db.prepare(`
      SELECT
        u.*,
        (SELECT COUNT(*) FROM appointments a WHERE a.user_id = u.id OR lower(a.client_email) = lower(u.email)) AS appointment_count,
        (SELECT COUNT(*) FROM appointments a WHERE (a.user_id = u.id OR lower(a.client_email) = lower(u.email)) AND a.start_ms > ?) AS upcoming_appointment_count
      FROM users u
      WHERE u.id=?
    `).get(Date.now(), id) as Record<string, unknown>;

    return { ok: true, client: rowToClient(after), changed: changed.length, backupPath };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    db.close();
  }
}
