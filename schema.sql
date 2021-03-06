CREATE TABLE players (
  id SERIAL PRIMARY KEY,
  name VARCHAR(30),
  is_primary BOOLEAN DEFAULT false
);

CREATE TABLE competitions (
  id SERIAL PRIMARY KEY,
  name VARCHAR(20),
  player_1 INTEGER REFERENCES players(id),
  player_2 INTEGER REFERENCES players(id),
  player_3 INTEGER REFERENCES players(id),
  player_4 INTEGER REFERENCES players(id),
  player_5 INTEGER REFERENCES players(id),
  player_6 INTEGER REFERENCES players(id),
  is_finished BOOLEAN DEFAULT false
);

CREATE TABLE games (
  id SERIAL PRIMARY KEY,
  type VARCHAR(20),
  competition_id INTEGER REFERENCES competitions(id),
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

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(20),
  password VARCHAR(32)
);

CREATE TABLE tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  token VARCHAR(16),
  created_on TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_used_on TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
