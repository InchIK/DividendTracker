PRAGMA foreign_keys = ON;

CREATE TABLE application_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL,
    updated_by_user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL,
    updated_at TEXT NOT NULL
);
