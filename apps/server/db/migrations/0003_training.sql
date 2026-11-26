CREATE TABLE `engine_cache` (
	`position_id` text NOT NULL,
	`engine_version` text NOT NULL,
	`depth` integer NOT NULL,
	`multipv` integer NOT NULL,
	`multipv_json` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`position_id`, `engine_version`),
	FOREIGN KEY (`position_id`) REFERENCES `positions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `training_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`due` text NOT NULL,
	`stability` real DEFAULT 0 NOT NULL,
	`difficulty` real DEFAULT 0 NOT NULL,
	`scheduled_days` integer DEFAULT 0 NOT NULL,
	`learning_steps` integer DEFAULT 0 NOT NULL,
	`reps` integer DEFAULT 0 NOT NULL,
	`lapses` integer DEFAULT 0 NOT NULL,
	`state` integer DEFAULT 0 NOT NULL,
	`last_review` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `training_cards_target_idx` ON `training_cards` (`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `training_cards_due_idx` ON `training_cards` (`due`);--> statement-breakpoint
CREATE TABLE `training_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`card_id` text NOT NULL,
	`rating` integer NOT NULL,
	`correct` integer NOT NULL,
	`reviewed_at` text NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `training_cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `training_reviews_card_idx` ON `training_reviews` (`card_id`);