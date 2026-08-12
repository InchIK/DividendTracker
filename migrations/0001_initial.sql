PRAGMA foreign_keys = ON;

CREATE TABLE portfolio (
    code TEXT PRIMARY KEY
        CHECK (code IN ('0050', '0056', '00878', '00919')),
    display_name TEXT NOT NULL,
    current_shares INTEGER NOT NULL DEFAULT 0
        CHECK (current_shares >= 0),
    enabled INTEGER NOT NULL DEFAULT 1
        CHECK (enabled IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE fund_mapping (
    code TEXT PRIMARY KEY
        REFERENCES portfolio(code) ON DELETE CASCADE,
    fund_unified_no TEXT,
    fund_name TEXT,
    source_kind TEXT NOT NULL,
    source_observed_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE dividend_events (
    event_key TEXT PRIMARY KEY,
    code TEXT NOT NULL
        REFERENCES portfolio(code) ON DELETE CASCADE,
    ex_date TEXT NOT NULL,
    base_date TEXT,
    pay_date TEXT,
    dividend_micros INTEGER
        CHECK (dividend_micros IS NULL OR dividend_micros >= 0),
    eligible_shares_override INTEGER
        CHECK (
            eligible_shares_override IS NULL
            OR eligible_shares_override >= 0
        ),
    status TEXT NOT NULL
        CHECK (
            status IN (
                'schedule_only',
                'pending_amount',
                'announced',
                'verified',
                'paid',
                'cancelled',
                'conflict'
            )
        ),
    canonical_source_kind TEXT NOT NULL,
    canonical_source_priority INTEGER NOT NULL,
    manual_locked INTEGER NOT NULL DEFAULT 0
        CHECK (manual_locked IN (0, 1)),
    manual_note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(code, ex_date)
);

CREATE INDEX idx_dividend_events_pay_date
    ON dividend_events(pay_date);

CREATE INDEX idx_dividend_events_code_pay_date
    ON dividend_events(code, pay_date);

CREATE TABLE dividend_observations (
    observation_key TEXT PRIMARY KEY,
    event_key TEXT NOT NULL
        REFERENCES dividend_events(event_key) ON DELETE CASCADE,
    source_kind TEXT NOT NULL,
    source_priority INTEGER NOT NULL,
    source_url TEXT,
    ex_date TEXT,
    base_date TEXT,
    pay_date TEXT,
    dividend_micros INTEGER,
    source_observed_at TEXT NOT NULL,
    payload_sha256 TEXT NOT NULL,
    raw_payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(source_kind, payload_sha256)
);

CREATE INDEX idx_dividend_observations_event
    ON dividend_observations(event_key);

CREATE TABLE sync_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trigger_kind TEXT NOT NULL
        CHECK (trigger_kind IN ('cron', 'manual', 'startup', 'test')),
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL
        CHECK (status IN ('running', 'success', 'partial', 'failed')),
    mapping_rows_read INTEGER NOT NULL DEFAULT 0,
    schedule_rows_read INTEGER NOT NULL DEFAULT 0,
    dividend_rows_read INTEGER NOT NULL DEFAULT 0,
    observations_applied INTEGER NOT NULL DEFAULT 0,
    events_changed INTEGER NOT NULL DEFAULT 0,
    newest_source_date TEXT,
    error_code TEXT,
    error_message TEXT
);

CREATE TABLE source_status (
    source_kind TEXT PRIMARY KEY,
    last_attempt_at TEXT,
    last_success_at TEXT,
    last_http_status INTEGER,
    last_payload_sha256 TEXT,
    newest_source_date TEXT,
    status TEXT NOT NULL
        CHECK (status IN ('never', 'ok', 'stale', 'error')),
    error_message TEXT,
    updated_at TEXT NOT NULL
);

INSERT INTO portfolio (
    code,
    display_name,
    current_shares,
    enabled,
    created_at,
    updated_at
) VALUES
    ('0050', '元大台灣50', 0, 1, datetime('now'), datetime('now')),
    ('0056', '元大高股息', 0, 1, datetime('now'), datetime('now')),
    ('00878', '國泰永續高股息', 0, 1, datetime('now'), datetime('now')),
    ('00919', '群益台灣精選高息', 0, 1, datetime('now'), datetime('now'));