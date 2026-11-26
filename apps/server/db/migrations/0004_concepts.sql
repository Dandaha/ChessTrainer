CREATE TABLE `concept_links` (
	`concept_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`concept_id`, `target_type`, `target_id`),
	FOREIGN KEY (`concept_id`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `concept_links_target_idx` ON `concept_links` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `concepts` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL,
	`category` text,
	`body_md` text,
	`key_signs` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
