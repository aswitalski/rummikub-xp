CREATE TABLE players (
  id SERIAL PRIMARY KEY,
  name VARCHAR(30)
);

CREATE TABLE games (
  id SERIAL PRIMARY KEY,
  player_1 INTEGER REFERENCES players(id),
  player_2 INTEGER REFERENCES players(id),
  player_3 INTEGER REFERENCES players(id),
  player_4 INTEGER REFERENCES players(id),
  player_5 INTEGER REFERENCES players(id),
  player_6 INTEGER REFERENCES players(id)
);

CREATE TABLE rounds (
  id SERIAL PRIMARY KEY,
  game_id INTEGER REFERENCES games(id),
  ordinal INTEGER,
  score_1 INTEGER,
  score_2 INTEGER,
  score_3 INTEGER,
  score_4 INTEGER,
  score_5 INTEGER,
  score_6 INTEGER
);
