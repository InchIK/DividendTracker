PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = true;

DELETE FROM auth_sessions;
DELETE FROM google_accounts;
DELETE FROM widget_credentials;
DELETE FROM user_dividend_overrides;
DELETE FROM widget_appearance;
DELETE FROM watchlist;
DELETE FROM dividend_observations;
DELETE FROM price_observations;
DELETE FROM latest_prices;
DELETE FROM fund_mapping;
DELETE FROM dividend_events;
DELETE FROM legacy_profile_claim;
DELETE FROM application_settings;
DELETE FROM sync_runs;
DELETE FROM source_status;
DELETE FROM users;
DELETE FROM instruments;

PRAGMA foreign_key_check;
