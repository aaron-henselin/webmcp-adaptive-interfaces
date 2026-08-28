import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const catalogImports = sqliteTable("catalog_imports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  schemaVersion: integer("schema_version").notNull(),
  sourceFilename: text("source_filename").notNull(),
  sourceSha256: text("source_sha256").notNull(),
  importedAt: text("imported_at").notNull(),
  recordCount: integer("record_count").notNull(),
}, (table) => [uniqueIndex("idx_catalog_imports_sha256").on(table.sourceSha256)]);

export const games = sqliteTable("games", {
  appId: integer("app_id").primaryKey(),
  name: text("name").notNull(),
  releaseDate: text("release_date"),
  releaseYear: integer("release_year"),
  owners: text("owners").notNull(),
  ownersMin: integer("owners_min").notNull(),
  ownersMax: integer("owners_max").notNull(),
  peakCcu: integer("peak_ccu").notNull(),
  requiredAge: integer("required_age").notNull(),
  priceCents: integer("price_cents").notNull(),
  discountPercent: real("discount_percent").notNull(),
  dlcCount: integer("dlc_count").notNull(),
  metacriticScore: integer("metacritic_score").notNull(),
  userScore: integer("user_score").notNull(),
  positive: integer("positive").notNull(),
  negative: integer("negative").notNull(),
  reviewCount: integer("review_count").notNull(),
  positiveRatio: real("positive_ratio"),
  achievements: integer("achievements").notNull(),
  recommendations: integer("recommendations").notNull(),
  averageForever: integer("average_forever").notNull(),
  average2Weeks: integer("average_2weeks").notNull(),
  medianForever: integer("median_forever").notNull(),
  median2Weeks: integer("median_2weeks").notNull(),
  windows: integer("windows", { mode: "boolean" }).notNull(),
  mac: integer("mac", { mode: "boolean" }).notNull(),
  linux: integer("linux", { mode: "boolean" }).notNull(),
  headerImage: text("header_image"),
}, (table) => [index("idx_games_owners_max").on(table.ownersMax), index("idx_games_owners_band_max").on(table.owners, table.ownersMax), index("idx_games_price_cents").on(table.priceCents), index("idx_games_positive_ratio").on(table.positiveRatio), index("idx_games_peak_ccu").on(table.peakCcu), index("idx_games_release_year").on(table.releaseYear)]);

export const developers = sqliteTable("developers", { id: integer("id").primaryKey(), name: text("name").notNull().unique() });
export const publishers = sqliteTable("publishers", { id: integer("id").primaryKey(), name: text("name").notNull().unique() });
export const genres = sqliteTable("genres", { id: integer("id").primaryKey(), name: text("name").notNull().unique() });
export const categories = sqliteTable("categories", { id: integer("id").primaryKey(), name: text("name").notNull().unique() });
export const tags = sqliteTable("tags", { id: integer("id").primaryKey(), name: text("name").notNull().unique() });
export const languages = sqliteTable("languages", { id: integer("id").primaryKey(), name: text("name").notNull().unique() });

export const gameDevelopers = sqliteTable("game_developers", { appId: integer("app_id").notNull().references(() => games.appId, { onDelete: "cascade" }), developerId: integer("developer_id").notNull().references(() => developers.id, { onDelete: "cascade" }) }, (table) => [primaryKey({ columns: [table.appId, table.developerId] }), index("idx_game_developers_developer").on(table.developerId, table.appId)]);
export const gamePublishers = sqliteTable("game_publishers", { appId: integer("app_id").notNull().references(() => games.appId, { onDelete: "cascade" }), publisherId: integer("publisher_id").notNull().references(() => publishers.id, { onDelete: "cascade" }) }, (table) => [primaryKey({ columns: [table.appId, table.publisherId] }), index("idx_game_publishers_publisher").on(table.publisherId, table.appId)]);
export const gameGenres = sqliteTable("game_genres", { appId: integer("app_id").notNull().references(() => games.appId, { onDelete: "cascade" }), genreId: integer("genre_id").notNull().references(() => genres.id, { onDelete: "cascade" }) }, (table) => [primaryKey({ columns: [table.appId, table.genreId] }), index("idx_game_genres_genre").on(table.genreId, table.appId)]);
export const gameCategories = sqliteTable("game_categories", { appId: integer("app_id").notNull().references(() => games.appId, { onDelete: "cascade" }), categoryId: integer("category_id").notNull().references(() => categories.id, { onDelete: "cascade" }) }, (table) => [primaryKey({ columns: [table.appId, table.categoryId] }), index("idx_game_categories_category").on(table.categoryId, table.appId)]);
export const gameTags = sqliteTable("game_tags", { appId: integer("app_id").notNull().references(() => games.appId, { onDelete: "cascade" }), tagId: integer("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }), weight: integer("weight").notNull() }, (table) => [primaryKey({ columns: [table.appId, table.tagId] }), index("idx_game_tags_tag").on(table.tagId, table.appId)]);
export const gameLanguages = sqliteTable("game_languages", { appId: integer("app_id").notNull().references(() => games.appId, { onDelete: "cascade" }), languageId: integer("language_id").notNull().references(() => languages.id, { onDelete: "cascade" }), fullAudio: integer("full_audio", { mode: "boolean" }).notNull() }, (table) => [primaryKey({ columns: [table.appId, table.languageId] }), index("idx_game_languages_language").on(table.languageId, table.appId)]);
