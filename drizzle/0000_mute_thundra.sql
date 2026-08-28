CREATE TABLE `catalog_imports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`schema_version` integer NOT NULL,
	`source_filename` text NOT NULL,
	`source_sha256` text NOT NULL,
	`imported_at` text NOT NULL,
	`record_count` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_catalog_imports_sha256` ON `catalog_imports` (`source_sha256`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_name_unique` ON `categories` (`name`);--> statement-breakpoint
CREATE TABLE `developers` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `developers_name_unique` ON `developers` (`name`);--> statement-breakpoint
CREATE TABLE `game_categories` (
	`app_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	PRIMARY KEY(`app_id`, `category_id`),
	FOREIGN KEY (`app_id`) REFERENCES `games`(`app_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_game_categories_category` ON `game_categories` (`category_id`,`app_id`);--> statement-breakpoint
CREATE TABLE `game_developers` (
	`app_id` integer NOT NULL,
	`developer_id` integer NOT NULL,
	PRIMARY KEY(`app_id`, `developer_id`),
	FOREIGN KEY (`app_id`) REFERENCES `games`(`app_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`developer_id`) REFERENCES `developers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_game_developers_developer` ON `game_developers` (`developer_id`,`app_id`);--> statement-breakpoint
CREATE TABLE `game_genres` (
	`app_id` integer NOT NULL,
	`genre_id` integer NOT NULL,
	PRIMARY KEY(`app_id`, `genre_id`),
	FOREIGN KEY (`app_id`) REFERENCES `games`(`app_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`genre_id`) REFERENCES `genres`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_game_genres_genre` ON `game_genres` (`genre_id`,`app_id`);--> statement-breakpoint
CREATE TABLE `game_languages` (
	`app_id` integer NOT NULL,
	`language_id` integer NOT NULL,
	`full_audio` integer NOT NULL,
	PRIMARY KEY(`app_id`, `language_id`),
	FOREIGN KEY (`app_id`) REFERENCES `games`(`app_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`language_id`) REFERENCES `languages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_game_languages_language` ON `game_languages` (`language_id`,`app_id`);--> statement-breakpoint
CREATE TABLE `game_publishers` (
	`app_id` integer NOT NULL,
	`publisher_id` integer NOT NULL,
	PRIMARY KEY(`app_id`, `publisher_id`),
	FOREIGN KEY (`app_id`) REFERENCES `games`(`app_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`publisher_id`) REFERENCES `publishers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_game_publishers_publisher` ON `game_publishers` (`publisher_id`,`app_id`);--> statement-breakpoint
CREATE TABLE `game_tags` (
	`app_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	`weight` integer NOT NULL,
	PRIMARY KEY(`app_id`, `tag_id`),
	FOREIGN KEY (`app_id`) REFERENCES `games`(`app_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_game_tags_tag` ON `game_tags` (`tag_id`,`app_id`);--> statement-breakpoint
CREATE TABLE `games` (
	`app_id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`release_date` text,
	`release_year` integer,
	`owners` text NOT NULL,
	`owners_min` integer NOT NULL,
	`owners_max` integer NOT NULL,
	`peak_ccu` integer NOT NULL,
	`required_age` integer NOT NULL,
	`price_cents` integer NOT NULL,
	`discount_percent` real NOT NULL,
	`dlc_count` integer NOT NULL,
	`metacritic_score` integer NOT NULL,
	`user_score` integer NOT NULL,
	`positive` integer NOT NULL,
	`negative` integer NOT NULL,
	`review_count` integer NOT NULL,
	`positive_ratio` real,
	`achievements` integer NOT NULL,
	`recommendations` integer NOT NULL,
	`average_forever` integer NOT NULL,
	`average_2weeks` integer NOT NULL,
	`median_forever` integer NOT NULL,
	`median_2weeks` integer NOT NULL,
	`windows` integer NOT NULL,
	`mac` integer NOT NULL,
	`linux` integer NOT NULL,
	`header_image` text
);
--> statement-breakpoint
CREATE INDEX `idx_games_owners_max` ON `games` (`owners_max`);--> statement-breakpoint
CREATE INDEX `idx_games_price_cents` ON `games` (`price_cents`);--> statement-breakpoint
CREATE INDEX `idx_games_positive_ratio` ON `games` (`positive_ratio`);--> statement-breakpoint
CREATE INDEX `idx_games_peak_ccu` ON `games` (`peak_ccu`);--> statement-breakpoint
CREATE INDEX `idx_games_release_year` ON `games` (`release_year`);--> statement-breakpoint
CREATE TABLE `genres` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `genres_name_unique` ON `genres` (`name`);--> statement-breakpoint
CREATE TABLE `languages` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `languages_name_unique` ON `languages` (`name`);--> statement-breakpoint
CREATE TABLE `publishers` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publishers_name_unique` ON `publishers` (`name`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_unique` ON `tags` (`name`);