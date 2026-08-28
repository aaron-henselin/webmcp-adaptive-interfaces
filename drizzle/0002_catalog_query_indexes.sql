CREATE INDEX `idx_games_owners_band_max` ON `games` (`owners`, `owners_max`);
PRAGMA optimize;
