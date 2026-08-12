PRAGMA foreign_keys = ON;

ALTER TABLE widget_appearance
ADD COLUMN background_mode TEXT NOT NULL DEFAULT 'gradient'
    CHECK (background_mode IN ('solid', 'gradient'));

ALTER TABLE widget_appearance
ADD COLUMN start_color TEXT NOT NULL DEFAULT '#071426'
    CHECK (
        length(start_color) = 7
        AND substr(start_color, 1, 1) = '#'
        AND substr(start_color, 2) NOT GLOB '*[^0-9A-Fa-f]*'
    );

ALTER TABLE widget_appearance
ADD COLUMN end_color TEXT NOT NULL DEFAULT '#0F766E'
    CHECK (
        length(end_color) = 7
        AND substr(end_color, 1, 1) = '#'
        AND substr(end_color, 2) NOT GLOB '*[^0-9A-Fa-f]*'
    );

UPDATE widget_appearance
SET background_mode = 'gradient',
    start_color = CASE theme
        WHEN 'midnight' THEN '#020617'
        WHEN 'sunset' THEN '#2E1065'
        WHEN 'forest' THEN '#052E16'
        ELSE '#071426'
    END,
    end_color = CASE theme
        WHEN 'midnight' THEN '#334155'
        WHEN 'sunset' THEN '#BE123C'
        WHEN 'forest' THEN '#166534'
        ELSE '#0F766E'
    END;
