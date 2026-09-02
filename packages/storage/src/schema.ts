/** Shared DDL for sqlite / D1 / Turso (SQLite dialect). */
export const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fingerprint TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open',
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  release TEXT,
  environment TEXT,
  url TEXT
)`,
  `CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id INTEGER NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL,
  stack TEXT,
  url TEXT,
  user_agent TEXT,
  release TEXT,
  environment TEXT,
  user_id TEXT,
  extra TEXT,
  client TEXT,
  client_ip TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (issue_id) REFERENCES issues(id)
)`,
  `CREATE INDEX IF NOT EXISTS idx_issues_status_last_seen
  ON issues(status, last_seen DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_events_issue_id
  ON events(issue_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`,
] as const;

export const SCHEMA_SQL = `${SCHEMA_STATEMENTS.join(";\n\n")};`;

/** Additive migrations for existing databases (CREATE TABLE IF NOT EXISTS will not alter columns). */
export const SCHEMA_MIGRATIONS = [
  `ALTER TABLE events ADD COLUMN extra TEXT`,
  `ALTER TABLE events ADD COLUMN client TEXT`,
  `ALTER TABLE events ADD COLUMN client_ip TEXT`,
  `CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`,
] as const;

export function isIgnorableMigrationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /duplicate column|already exists/i.test(message);
}
