CREATE TABLE `games` (
	`id` text PRIMARY KEY NOT NULL,
	`pgn` text NOT NULL,
	`white` text,
	`black` text,
	`white_elo` integer,
	`black_elo` integer,
	`result` text,
	`date` text,
	`event` text,
	`eco` text,
	`opening_name` text,
	`my_color` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `positions` (
	`id` text PRIMARY KEY NOT NULL,
	`fen_key` text NOT NULL,
	`full_fen` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `positions_fen_key_unique` ON `positions` (`fen_key`);