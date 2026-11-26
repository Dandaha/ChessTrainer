CREATE TABLE `collection_games` (
	`collection_id` text NOT NULL,
	`game_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`collection_id`, `game_id`),
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `collections` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `game_positions` (
	`game_id` text NOT NULL,
	`ply` integer NOT NULL,
	`position_id` text NOT NULL,
	`next_san` text,
	PRIMARY KEY(`game_id`, `ply`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`position_id`) REFERENCES `positions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `game_positions_position_idx` ON `game_positions` (`position_id`);--> statement-breakpoint
CREATE TABLE `position_set_items` (
	`set_id` text NOT NULL,
	`saved_position_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`set_id`, `saved_position_id`),
	FOREIGN KEY (`set_id`) REFERENCES `position_sets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`saved_position_id`) REFERENCES `saved_positions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `position_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `saved_positions` (
	`id` text PRIMARY KEY NOT NULL,
	`position_id` text NOT NULL,
	`fen` text NOT NULL,
	`title` text NOT NULL,
	`notes_md` text,
	`category` text,
	`key_idea` text,
	`answer` text,
	`side_to_solve` text NOT NULL,
	`difficulty` integer,
	`in_training` integer DEFAULT false NOT NULL,
	`source_game_id` text,
	`source_ply` integer,
	`source_label` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`position_id`) REFERENCES `positions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `saved_positions_position_idx` ON `saved_positions` (`position_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `taggings` (
	`tag_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	PRIMARY KEY(`tag_id`, `target_type`, `target_id`),
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `taggings_target_idx` ON `taggings` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_unique` ON `tags` (`name`);--> statement-breakpoint
ALTER TABLE `games` ADD `source_ref` text;--> statement-breakpoint
CREATE INDEX `games_source_ref_idx` ON `games` (`source_ref`);--> statement-breakpoint
CREATE INDEX `games_date_idx` ON `games` (`date`);