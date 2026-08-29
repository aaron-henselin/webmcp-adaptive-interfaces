CREATE TABLE companies (
  id integer PRIMARY KEY NOT NULL,
  name text NOT NULL,
  is_developer integer NOT NULL,
  is_publisher integer NOT NULL,
  game_count integer NOT NULL
);
CREATE UNIQUE INDEX companies_name_unique ON companies (name);
CREATE INDEX idx_companies_game_count ON companies (game_count);

CREATE VIRTUAL TABLE company_search USING fts5(
  company_id UNINDEXED,
  name,
  tokenize = 'unicode61 remove_diacritics 2'
);

WITH company_names AS (
  SELECT name FROM developers
  UNION
  SELECT name FROM publishers
)
INSERT INTO companies (id, name, is_developer, is_publisher, game_count)
SELECT
  ROW_NUMBER() OVER (ORDER BY lower(company_names.name), company_names.name),
  company_names.name,
  EXISTS(SELECT 1 FROM developers WHERE developers.name = company_names.name),
  EXISTS(SELECT 1 FROM publishers WHERE publishers.name = company_names.name),
  (
    SELECT COUNT(*) FROM (
      SELECT game_developers.app_id
      FROM game_developers
      JOIN developers ON developers.id = game_developers.developer_id
      WHERE developers.name = company_names.name
      UNION
      SELECT game_publishers.app_id
      FROM game_publishers
      JOIN publishers ON publishers.id = game_publishers.publisher_id
      WHERE publishers.name = company_names.name
    ) company_games
  )
FROM company_names;

INSERT INTO company_search (company_id, name)
SELECT id, name FROM companies;

PRAGMA optimize;
