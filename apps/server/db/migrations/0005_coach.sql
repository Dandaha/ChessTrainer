CREATE TABLE `coach_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`position_id` text NOT NULL,
	`role` text NOT NULL,
	`mode` text NOT NULL,
	`model` text,
	`content` text NOT NULL,
	`tool_trace_json` text,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`position_id`) REFERENCES `positions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `coach_messages_position_idx` ON `coach_messages` (`position_id`);--> statement-breakpoint
CREATE INDEX `coach_messages_created_idx` ON `coach_messages` (`created_at`);