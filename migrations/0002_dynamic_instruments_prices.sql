PRAGMA foreign_keys = ON;

CREATE TABLE instruments_v2 (
    instrument_id TEXT PRIMARY KEY,
    market TEXT NOT NULL
        CHECK (market IN ('twse', 'tpex')),
    code TEXT NOT NULL,
    kind TEXT NOT NULL
        CHECK (kind IN ('stock', 'etf')),
    display_name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
        CHECK (active IN (0, 1)),
    metadata_source TEXT,
    metadata_observed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (instrument_id = market || ':' || code),
    UNIQUE (market, code)
);

CREATE TABLE watchlist_v2 (
    instrument_id TEXT PRIMARY KEY
        REFERENCES instruments_v2(instrument_id) ON DELETE RESTRICT,
    current_shares INTEGER NOT NULL DEFAULT 0
        CHECK (current_shares >= 0),
    enabled INTEGER NOT NULL DEFAULT 1
        CHECK (enabled IN (0, 1)),
    archived_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE fund_mapping_v2 (
    instrument_id TEXT PRIMARY KEY
        REFERENCES instruments_v2(instrument_id) ON DELETE RESTRICT,
    fund_unified_no TEXT,
    fund_name TEXT,
    source_kind TEXT NOT NULL,
    source_observed_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE dividend_events_v2 (
    event_key TEXT PRIMARY KEY,
    instrument_id TEXT NOT NULL
        REFERENCES instruments_v2(instrument_id) ON DELETE RESTRICT,
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
    CHECK (event_key = instrument_id || ':' || ex_date),
    UNIQUE (instrument_id, ex_date)
);

CREATE TABLE dividend_observations_v2 (
    observation_key TEXT PRIMARY KEY,
    event_key TEXT NOT NULL
        REFERENCES dividend_events_v2(event_key) ON DELETE CASCADE,
    source_kind TEXT NOT NULL,
    source_priority INTEGER NOT NULL,
    source_url TEXT,
    ex_date TEXT,
    base_date TEXT,
    pay_date TEXT,
    dividend_micros INTEGER
        CHECK (dividend_micros IS NULL OR dividend_micros >= 0),
    source_observed_at TEXT NOT NULL,
    payload_sha256 TEXT NOT NULL,
    raw_payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (source_kind, payload_sha256)
);

INSERT INTO instruments_v2 (
    instrument_id,
    market,
    code,
    kind,
    display_name,
    active,
    metadata_source,
    metadata_observed_at,
    created_at,
    updated_at
)
SELECT
    'twse:' || p.code,
    'twse',
    p.code,
    'etf',
    p.display_name,
    1,
    fm.source_kind,
    fm.source_observed_at,
    p.created_at,
    p.updated_at
FROM portfolio AS p
LEFT JOIN fund_mapping AS fm ON fm.code = p.code;

INSERT INTO watchlist_v2 (
    instrument_id,
    current_shares,
    enabled,
    archived_at,
    created_at,
    updated_at
)
SELECT
    'twse:' || code,
    current_shares,
    enabled,
    NULL,
    created_at,
    updated_at
FROM portfolio;

INSERT INTO fund_mapping_v2 (
    instrument_id,
    fund_unified_no,
    fund_name,
    source_kind,
    source_observed_at,
    updated_at
)
SELECT
    'twse:' || code,
    fund_unified_no,
    fund_name,
    source_kind,
    source_observed_at,
    updated_at
FROM fund_mapping;

INSERT INTO dividend_events_v2 (
    event_key,
    instrument_id,
    ex_date,
    base_date,
    pay_date,
    dividend_micros,
    eligible_shares_override,
    status,
    canonical_source_kind,
    canonical_source_priority,
    manual_locked,
    manual_note,
    created_at,
    updated_at
)
SELECT
    'twse:' || code || ':' || ex_date,
    'twse:' || code,
    ex_date,
    base_date,
    pay_date,
    dividend_micros,
    eligible_shares_override,
    status,
    canonical_source_kind,
    canonical_source_priority,
    manual_locked,
    manual_note,
    created_at,
    updated_at
FROM dividend_events;

INSERT INTO dividend_observations_v2 (
    observation_key,
    event_key,
    source_kind,
    source_priority,
    source_url,
    ex_date,
    base_date,
    pay_date,
    dividend_micros,
    source_observed_at,
    payload_sha256,
    raw_payload,
    created_at
)
SELECT
    o.observation_key,
    'twse:' || e.code || ':' || e.ex_date,
    o.source_kind,
    o.source_priority,
    o.source_url,
    o.ex_date,
    o.base_date,
    o.pay_date,
    o.dividend_micros,
    o.source_observed_at,
    o.payload_sha256,
    o.raw_payload,
    o.created_at
FROM dividend_observations AS o
JOIN dividend_events AS e ON e.event_key = o.event_key;

DROP TABLE dividend_observations;
DROP TABLE dividend_events;
DROP TABLE fund_mapping;
DROP TABLE portfolio;

ALTER TABLE instruments_v2 RENAME TO instruments;
ALTER TABLE watchlist_v2 RENAME TO watchlist;
ALTER TABLE fund_mapping_v2 RENAME TO fund_mapping;
ALTER TABLE dividend_events_v2 RENAME TO dividend_events;
ALTER TABLE dividend_observations_v2 RENAME TO dividend_observations;

CREATE INDEX idx_watchlist_enabled
    ON watchlist(enabled, archived_at);
CREATE INDEX idx_dividend_events_pay_date
    ON dividend_events(pay_date);
CREATE INDEX idx_dividend_events_instrument_pay_date
    ON dividend_events(instrument_id, pay_date);
CREATE INDEX idx_dividend_observations_event
    ON dividend_observations(event_key);

CREATE TABLE latest_prices (
    instrument_id TEXT PRIMARY KEY
        REFERENCES instruments(instrument_id) ON DELETE RESTRICT,
    price_micros INTEGER
        CHECK (price_micros IS NULL OR price_micros > 0),
    previous_close_micros INTEGER
        CHECK (previous_close_micros IS NULL OR previous_close_micros > 0),
    trade_date TEXT,
    trade_time TEXT,
    market_state TEXT NOT NULL
        CHECK (market_state IN ('trading', 'closed', 'halted', 'no_trade', 'unknown')),
    status TEXT NOT NULL
        CHECK (status IN ('complete', 'partial', 'not_covered', 'stale', 'error')),
    source TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    stale INTEGER NOT NULL DEFAULT 0
        CHECK (stale IN (0, 1)),
    error_message TEXT,
    updated_at TEXT NOT NULL,
    CHECK (
        status <> 'complete'
        OR (price_micros IS NOT NULL AND previous_close_micros IS NOT NULL)
    )
);

CREATE TABLE price_observations (
    observation_key TEXT PRIMARY KEY,
    instrument_id TEXT NOT NULL
        REFERENCES instruments(instrument_id) ON DELETE RESTRICT,
    price_micros INTEGER
        CHECK (price_micros IS NULL OR price_micros > 0),
    previous_close_micros INTEGER
        CHECK (previous_close_micros IS NULL OR previous_close_micros > 0),
    trade_date TEXT,
    trade_time TEXT,
    market_state TEXT NOT NULL
        CHECK (market_state IN ('trading', 'closed', 'halted', 'no_trade', 'unknown')),
    status TEXT NOT NULL
        CHECK (status IN ('complete', 'partial', 'not_covered', 'stale', 'error')),
    source TEXT NOT NULL,
    http_status INTEGER
        CHECK (http_status IS NULL OR (http_status >= 100 AND http_status <= 599)),
    observed_at TEXT NOT NULL,
    payload_sha256 TEXT NOT NULL,
    raw_payload TEXT NOT NULL
        CHECK (length(raw_payload) <= 16384),
    error_message TEXT,
    created_at TEXT NOT NULL,
    CHECK (
        status <> 'complete'
        OR (price_micros IS NOT NULL AND previous_close_micros IS NOT NULL)
    ),
    UNIQUE (source, payload_sha256)
);

CREATE INDEX idx_price_observations_instrument_observed
    ON price_observations(instrument_id, observed_at);
