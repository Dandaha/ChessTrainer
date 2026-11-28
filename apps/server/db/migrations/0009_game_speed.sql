ALTER TABLE `games` ADD `time_control` text;--> statement-breakpoint
ALTER TABLE `games` ADD `speed` text;--> statement-breakpoint
CREATE INDEX `games_speed_idx` ON `games` (`speed`);;--> statement-breakpoint
-- Games already in the library: the TimeControl tag from their PGN, then the speed it means
-- (game_speed is chess-core's speedOf, registered on every connection by db/client.ts).
UPDATE `games` SET `time_control` = substr(`pgn`, instr(`pgn`, '[TimeControl "') + 14, instr(substr(`pgn`, instr(`pgn`, '[TimeControl "') + 14), '"') - 1) WHERE instr(`pgn`, '[TimeControl "') > 0;--> statement-breakpoint
UPDATE `games` SET `speed` = game_speed(`time_control`, `event`);
