CREATE TABLE `repertoire_moves` (
	`id` text PRIMARY KEY NOT NULL,
	`repertoire_id` text NOT NULL,
	`from_position_id` text NOT NULL,
	`to_position_id` text NOT NULL,
	`san` text NOT NULL,
	`uci` text NOT NULL,
	`is_my_move` integer NOT NULL,
	`is_main` integer DEFAULT false NOT NULL,
	`priority` text DEFAULT 'must' NOT NULL,
	`comment_md` text,
	`nags` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`repertoire_id`) REFERENCES `repertoires`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_position_id`) REFERENCES `positions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_position_id`) REFERENCES `positions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repertoire_moves_edge_idx` ON `repertoire_moves` (`repertoire_id`,`from_position_id`,`uci`);--> statement-breakpoint
CREATE INDEX `repertoire_moves_from_idx` ON `repertoire_moves` (`from_position_id`);--> statement-breakpoint
CREATE TABLE `repertoires` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
