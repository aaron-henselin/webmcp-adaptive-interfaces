CREATE TABLE company_search_grams (
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  gram text NOT NULL,
  PRIMARY KEY (company_id, gram)
);

CREATE INDEX idx_company_search_grams_gram
ON company_search_grams (gram, company_id);

WITH RECURSIVE company_grams(company_id, name, position) AS (
  SELECT id, lower(trim(name)), 1
  FROM companies
  WHERE length(trim(name)) >= 3
  UNION ALL
  SELECT company_id, name, position + 1
  FROM company_grams
  WHERE position + 2 < length(name)
)
INSERT OR IGNORE INTO company_search_grams (company_id, gram)
SELECT company_id, substr(name, position, 3)
FROM company_grams;

PRAGMA optimize;
