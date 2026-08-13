PRAGMA foreign_keys = ON;

ALTER TABLE widget_appearance
ADD COLUMN sort_mode TEXT NOT NULL DEFAULT 'dividend_desc'
    CHECK (sort_mode IN ('dividend_desc', 'random', 'price_desc', 'featured'));

ALTER TABLE widget_appearance
ADD COLUMN featured_instrument_id TEXT NULL;

ALTER TABLE widget_appearance
ADD COLUMN refresh_minutes INTEGER NOT NULL DEFAULT 180
    CHECK (refresh_minutes BETWEEN 15 AND 1440);
