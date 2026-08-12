PRAGMA foreign_keys = ON;

CREATE TABLE widget_appearance (
    singleton_id INTEGER PRIMARY KEY
        CHECK (singleton_id = 1),
    theme TEXT NOT NULL
        CHECK (theme IN ('ocean', 'midnight', 'sunset', 'forest')),
    updated_at TEXT NOT NULL
);

INSERT INTO widget_appearance (singleton_id, theme, updated_at)
VALUES (1, 'ocean', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
