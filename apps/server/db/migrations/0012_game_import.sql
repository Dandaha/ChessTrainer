ALTER TABLE `games` ADD `import_id` text;--> statement-breakpoint
CREATE INDEX `games_import_idx` ON `games` (`import_id`);