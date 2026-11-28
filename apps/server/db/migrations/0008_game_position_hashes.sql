-- The game index stores each position as position_hash(fen_key), a 64-bit hash computed by the
-- function db/client.ts registers on every connection; position rows nothing else points at go.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_game_positions` (
	`game_id` text NOT NULL,
	`ply` integer NOT NULL,
	`position_hash` integer NOT NULL,
	`next_san` text,
	PRIMARY KEY(`game_id`, `ply`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_game_positions`("game_id", "ply", "position_hash", "next_san") SELECT gp."game_id", gp."ply", position_hash(p."fen_key"), gp."next_san" FROM `game_positions` gp JOIN `positions` p ON p."id" = gp."position_id";--> statement-breakpoint
DROP TABLE `game_positions`;--> statement-breakpoint
ALTER TABLE `__new_game_positions` RENAME TO `game_positions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `game_positions_hash_idx` ON `game_positions` (`position_hash`);--> statement-breakpoint
DELETE FROM `positions` WHERE
	NOT EXISTS (SELECT 1 FROM `saved_positions` s WHERE s."position_id" = `positions`."id")
	AND NOT EXISTS (SELECT 1 FROM `repertoire_moves` m WHERE m."from_position_id" = `positions`."id" OR m."to_position_id" = `positions`."id")
	AND NOT EXISTS (SELECT 1 FROM `engine_cache` e WHERE e."position_id" = `positions`."id")
	AND NOT EXISTS (SELECT 1 FROM `coach_messages` c WHERE c."position_id" = `positions`."id")
	AND NOT EXISTS (SELECT 1 FROM `concept_links` l WHERE l."target_type" = 'position' AND l."target_id" = `positions`."id");
