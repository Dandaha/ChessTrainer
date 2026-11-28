ALTER TABLE `games` ADD `time` text;--> statement-breakpoint
-- Fill it in for games already in the library, from the UTCTime tag (Lichess, Chess.com), else Time.
UPDATE `games` SET `time` = substr(`pgn`, instr(`pgn`, '[UTCTime "') + 10, 8) WHERE instr(`pgn`, '[UTCTime "') > 0;
--> statement-breakpoint
UPDATE `games` SET `time` = substr(`pgn`, instr(`pgn`, '[Time "') + 7, 8) WHERE `time` IS NULL AND instr(`pgn`, '[Time "') > 0;
