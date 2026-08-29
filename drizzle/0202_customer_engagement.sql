CREATE TABLE engagement_shops (
  id integer PRIMARY KEY NOT NULL,
  name text NOT NULL,
  region text NOT NULL
);
CREATE UNIQUE INDEX engagement_shops_name_unique ON engagement_shops (name);

CREATE TABLE engagement_users (
  id integer PRIMARY KEY NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text NOT NULL,
  sex text NOT NULL,
  customer_type text NOT NULL,
  city text NOT NULL,
  region text NOT NULL,
  joined_at text NOT NULL,
  status text NOT NULL
);
CREATE UNIQUE INDEX engagement_users_email_unique ON engagement_users (email);
CREATE INDEX idx_engagement_users_type ON engagement_users (customer_type);
CREATE INDEX idx_engagement_users_sex ON engagement_users (sex);

CREATE TABLE engagement_sessions (
  id integer PRIMARY KEY NOT NULL,
  user_id integer NOT NULL,
  app_id integer NOT NULL,
  shop_id integer NOT NULL,
  started_at text NOT NULL,
  duration_seconds integer NOT NULL,
  device_type text NOT NULL,
  signed_up integer NOT NULL,
  activated integer NOT NULL,
  subscribed integer NOT NULL,
  FOREIGN KEY (user_id) REFERENCES engagement_users(id) ON DELETE cascade,
  FOREIGN KEY (app_id) REFERENCES games(app_id) ON DELETE cascade,
  FOREIGN KEY (shop_id) REFERENCES engagement_shops(id)
);
CREATE INDEX idx_engagement_sessions_started ON engagement_sessions (started_at);
CREATE INDEX idx_engagement_sessions_user_started ON engagement_sessions (user_id, started_at);
CREATE INDEX idx_engagement_sessions_shop_started ON engagement_sessions (shop_id, started_at);
CREATE INDEX idx_engagement_sessions_app_started ON engagement_sessions (app_id, started_at);
CREATE INDEX idx_engagement_sessions_device_started ON engagement_sessions (device_type, started_at);

INSERT INTO engagement_shops (id, name, region) VALUES
  (1, 'Northstar Online', 'North America'),
  (2, 'Harbor Point', 'North America'),
  (3, 'Arcade Central', 'Europe'),
  (4, 'Pacific Play', 'Asia Pacific'),
  (5, 'Summit Games', 'Europe'),
  (6, 'Metro Download', 'Asia Pacific');

WITH
digits(d) AS (VALUES (0), (1), (2), (3), (4), (5), (6), (7), (8), (9)),
numbers(n) AS (
  SELECT 1 + a.d + b.d * 10 + c.d * 100 + d.d * 1000 + e.d * 10000
  FROM digits a CROSS JOIN digits b CROSS JOIN digits c CROSS JOIN digits d CROSS JOIN digits e
)
INSERT INTO engagement_users (
  id, first_name, last_name, email, sex, customer_type, city, region, joined_at, status
)
SELECT
  n,
  CASE n % 16
    WHEN 0 THEN 'Avery' WHEN 1 THEN 'Jordan' WHEN 2 THEN 'Maya' WHEN 3 THEN 'Theo'
    WHEN 4 THEN 'Noor' WHEN 5 THEN 'Elliot' WHEN 6 THEN 'Camille' WHEN 7 THEN 'Mateo'
    WHEN 8 THEN 'Priya' WHEN 9 THEN 'Rowan' WHEN 10 THEN 'Sofia' WHEN 11 THEN 'Kai'
    WHEN 12 THEN 'Amara' WHEN 13 THEN 'Lucas' WHEN 14 THEN 'Mei' ELSE 'Sam'
  END,
  CASE (n * 7) % 16
    WHEN 0 THEN 'Martin' WHEN 1 THEN 'Chen' WHEN 2 THEN 'Rivera' WHEN 3 THEN 'Patel'
    WHEN 4 THEN 'Johnson' WHEN 5 THEN 'Nguyen' WHEN 6 THEN 'Dubois' WHEN 7 THEN 'Kim'
    WHEN 8 THEN 'Brown' WHEN 9 THEN 'Singh' WHEN 10 THEN 'Garcia' WHEN 11 THEN 'Wilson'
    WHEN 12 THEN 'Taylor' WHEN 13 THEN 'Anderson' WHEN 14 THEN 'Lopez' ELSE 'Moore'
  END,
  printf('customer%05d@example.com', n),
  CASE n % 20 WHEN 0 THEN 'Non-binary' WHEN 1 THEN 'Undisclosed' WHEN 2 THEN 'Undisclosed' ELSE CASE n % 2 WHEN 0 THEN 'Female' ELSE 'Male' END END,
  CASE n % 10 WHEN 0 THEN 'Loyal' WHEN 1 THEN 'Loyal' WHEN 2 THEN 'New' WHEN 3 THEN 'New' ELSE 'Returning' END,
  CASE n % 8
    WHEN 0 THEN 'Montréal' WHEN 1 THEN 'Toronto' WHEN 2 THEN 'Seattle' WHEN 3 THEN 'Austin'
    WHEN 4 THEN 'London' WHEN 5 THEN 'Berlin' WHEN 6 THEN 'Singapore' ELSE 'Sydney'
  END,
  CASE n % 8
    WHEN 0 THEN 'QC' WHEN 1 THEN 'ON' WHEN 2 THEN 'WA' WHEN 3 THEN 'TX'
    WHEN 4 THEN 'UK' WHEN 5 THEN 'DE' WHEN 6 THEN 'SG' ELSE 'NSW'
  END,
  date('2025-08-01', '+' || ((n * 13) % 365) || ' days'),
  CASE WHEN n % 17 = 0 THEN 'Inactive' ELSE 'Active' END
FROM numbers
WHERE n <= 24509;

WITH
passes(pass) AS (VALUES (0), (1)),
ranked_games AS (
  SELECT app_id, ROW_NUMBER() OVER (ORDER BY owners_max DESC, app_id) AS rn
  FROM games
  ORDER BY owners_max DESC, app_id
  LIMIT 30000
),
session_rows AS (
  SELECT
    (g.rn - 1) * 2 + p.pass + 1 AS session_id,
    g.rn,
    g.app_id,
    p.pass,
    ((g.rn * 37 + p.pass * 7919) % 24509) + 1 AS user_id,
    ((g.rn + p.pass * 3) % 6) + 1 AS shop_id,
    (g.rn * 17 + p.pass * 11) % 100 AS journey_score
  FROM ranked_games g CROSS JOIN passes p
)
INSERT INTO engagement_sessions (
  id, user_id, app_id, shop_id, started_at, duration_seconds, device_type, signed_up, activated, subscribed
)
SELECT
  session_id,
  user_id,
  app_id,
  shop_id,
  datetime(
    '2026-05-31',
    '+' || ((rn * 7 + pass * 19) % 90) || ' days',
    '+' || ((rn * 13 + pass * 5) % 24) || ' hours',
    '+' || ((rn * 23 + pass * 17) % 60) || ' minutes'
  ),
  45 + ((rn * 97 + pass * 701) % 2700),
  CASE (rn * 11 + pass * 17) % 100 WHEN 0 THEN 'Tablet' ELSE
    CASE WHEN (rn * 11 + pass * 17) % 100 < 17 THEN 'Tablet'
      WHEN (rn * 11 + pass * 17) % 100 < 49 THEN 'Mobile'
      ELSE 'Desktop'
    END
  END,
  journey_score < 43,
  journey_score < 27,
  journey_score < 11
FROM session_rows;

PRAGMA optimize;
