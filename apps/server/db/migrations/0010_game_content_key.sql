ALTER TABLE `games` ADD `content_key` text;--> statement-breakpoint
CREATE INDEX `games_content_key_idx` ON `games` (`content_key`);