PRAGMA foreign_keys = ON;

CREATE TABLE users (
    user_id TEXT PRIMARY KEY,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_iterations INTEGER NOT NULL CHECK (password_iterations >= 100000),
    role TEXT NOT NULL CHECK (role IN ('owner', 'user')),
    account_status TEXT NOT NULL DEFAULT 'active'
        CHECK (account_status IN ('active', 'disabled', 'pending_claim')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_users_single_active_owner
    ON users(role)
    WHERE role = 'owner' AND account_status = 'active';

CREATE TABLE auth_sessions (
    session_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    user_agent TEXT
);

CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id, expires_at);

CREATE TABLE google_accounts (
    google_sub TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    email TEXT NOT NULL COLLATE NOCASE,
    created_at TEXT NOT NULL,
    UNIQUE(user_id)
);

CREATE TABLE widget_credentials (
    user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    token_ciphertext TEXT NOT NULL,
    token_iv TEXT NOT NULL,
    token_suffix TEXT NOT NULL,
    created_at TEXT NOT NULL,
    rotated_at TEXT NOT NULL
);

INSERT INTO users (
    user_id, username, display_name, password_hash, password_salt,
    password_iterations, role, account_status, created_at, updated_at
) VALUES (
    'legacy-unclaimed', '__legacy_unclaimed__', 'Legacy profile', 'unusable',
    'unusable', 100000, 'owner', 'pending_claim',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);

ALTER TABLE dividend_events
ADD COLUMN owner_user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE;

CREATE INDEX idx_dividend_events_owner
    ON dividend_events(owner_user_id, instrument_id, pay_date);

CREATE TABLE user_dividend_overrides (
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    event_key TEXT NOT NULL REFERENCES dividend_events(event_key) ON DELETE CASCADE,
    base_date TEXT,
    pay_date TEXT,
    dividend_micros INTEGER CHECK (dividend_micros IS NULL OR dividend_micros >= 0),
    eligible_shares_override INTEGER
        CHECK (eligible_shares_override IS NULL OR eligible_shares_override >= 0),
    manual_locked INTEGER NOT NULL DEFAULT 1 CHECK (manual_locked IN (0, 1)),
    manual_note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, event_key)
);

INSERT INTO user_dividend_overrides (
    user_id, event_key, base_date, pay_date, dividend_micros,
    eligible_shares_override, manual_locked, manual_note, created_at, updated_at
)
SELECT
    'legacy-unclaimed', event_key, base_date, pay_date, dividend_micros,
    eligible_shares_override, manual_locked, manual_note, created_at, updated_at
FROM dividend_events
WHERE manual_locked = 1
   OR manual_note IS NOT NULL
   OR canonical_source_kind = 'manual_verified';

UPDATE dividend_events
SET owner_user_id = 'legacy-unclaimed',
    manual_locked = 0,
    manual_note = NULL
WHERE event_key IN (
    SELECT event_key
    FROM user_dividend_overrides
    WHERE user_id = 'legacy-unclaimed'
);

CREATE TABLE legacy_profile_claim (
    singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
    claimed_by_user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL,
    claimed_at TEXT
);

INSERT INTO legacy_profile_claim (singleton_id, claimed_by_user_id, claimed_at)
VALUES (1, NULL, NULL);

CREATE TABLE watchlist_v3 (
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    instrument_id TEXT NOT NULL REFERENCES instruments(instrument_id) ON DELETE RESTRICT,
    display_name_override TEXT,
    current_shares INTEGER NOT NULL DEFAULT 0 CHECK (current_shares >= 0),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    archived_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, instrument_id)
);

INSERT INTO watchlist_v3 (
    user_id, instrument_id, display_name_override, current_shares, enabled, archived_at, created_at, updated_at
)
SELECT 'legacy-unclaimed', instrument_id, NULL, current_shares, enabled, archived_at, created_at, updated_at
FROM watchlist;

DROP TABLE watchlist;
ALTER TABLE watchlist_v3 RENAME TO watchlist;
CREATE INDEX idx_watchlist_user_enabled
    ON watchlist(user_id, enabled, archived_at);
CREATE INDEX idx_watchlist_instrument_enabled
    ON watchlist(instrument_id, enabled, archived_at);

CREATE TABLE widget_appearance_v2 (
    user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
    theme TEXT NOT NULL CHECK (theme IN ('ocean', 'midnight', 'sunset', 'forest')),
    background_mode TEXT NOT NULL DEFAULT 'gradient'
        CHECK (background_mode IN ('solid', 'gradient')),
    start_color TEXT NOT NULL,
    end_color TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (
        length(start_color) = 7 AND substr(start_color, 1, 1) = '#'
        AND substr(start_color, 2) NOT GLOB '*[^0-9A-Fa-f]*'
    ),
    CHECK (
        length(end_color) = 7 AND substr(end_color, 1, 1) = '#'
        AND substr(end_color, 2) NOT GLOB '*[^0-9A-Fa-f]*'
    )
);

INSERT INTO widget_appearance_v2 (
    user_id, theme, background_mode, start_color, end_color, updated_at
)
SELECT 'legacy-unclaimed', theme, background_mode, start_color, end_color, updated_at
FROM widget_appearance
WHERE singleton_id = 1;

DROP TABLE widget_appearance;
ALTER TABLE widget_appearance_v2 RENAME TO widget_appearance;
