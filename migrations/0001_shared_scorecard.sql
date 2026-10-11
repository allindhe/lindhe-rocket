CREATE TABLE scorecard_rounds (
    id TEXT PRIMARY KEY,
    course_name TEXT NOT NULL,
    played_on DATE NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE scorecard_players (
    round_id TEXT NOT NULL REFERENCES scorecard_rounds(id) ON DELETE CASCADE,
    player_id TEXT NOT NULL,
    name TEXT NOT NULL,
    PRIMARY KEY (round_id, player_id),
    CHECK (player_id IN ('player-1', 'player-2', 'player-3', 'player-4'))
);

CREATE TABLE scorecard_holes (
    round_id TEXT NOT NULL REFERENCES scorecard_rounds(id) ON DELETE CASCADE,
    hole_id TEXT NOT NULL,
    hole_number SMALLINT NOT NULL,
    par SMALLINT NOT NULL CHECK (par BETWEEN 3 AND 5),
    PRIMARY KEY (round_id, hole_id),
    UNIQUE (round_id, hole_number),
    CHECK (hole_number BETWEEN 1 AND 9)
);

CREATE TABLE scorecard_scores (
    round_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    hole_id TEXT NOT NULL,
    strokes SMALLINT NOT NULL CHECK (strokes BETWEEN 1 AND 99),
    PRIMARY KEY (round_id, player_id, hole_id),
    FOREIGN KEY (round_id, player_id)
        REFERENCES scorecard_players(round_id, player_id) ON DELETE CASCADE,
    FOREIGN KEY (round_id, hole_id)
        REFERENCES scorecard_holes(round_id, hole_id) ON DELETE CASCADE
);

INSERT INTO scorecard_rounds (id, course_name, played_on)
VALUES ('round-demo-001', 'The home course', CURRENT_DATE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO scorecard_players (round_id, player_id, name)
VALUES
    ('round-demo-001', 'player-1', 'Player 1'),
    ('round-demo-001', 'player-2', 'Player 2'),
    ('round-demo-001', 'player-3', 'Player 3'),
    ('round-demo-001', 'player-4', 'Player 4')
ON CONFLICT (round_id, player_id) DO NOTHING;

INSERT INTO scorecard_holes (round_id, hole_id, hole_number, par)
SELECT 'round-demo-001', 'hole-' || hole_number, hole_number, 4
FROM generate_series(1, 9) AS holes(hole_number)
ON CONFLICT (round_id, hole_id) DO NOTHING;