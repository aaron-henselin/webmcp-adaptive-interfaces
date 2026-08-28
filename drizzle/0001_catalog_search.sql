CREATE VIRTUAL TABLE `game_search` USING fts5(
  `app_id` UNINDEXED,
  `name`,
  `developers`,
  `publishers`,
  `genres`,
  `tags`,
  tokenize = 'unicode61 remove_diacritics 2'
);
