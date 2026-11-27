CREATE TABLE `position_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `position_categories_name_idx` ON `position_categories` (`name`);
--> statement-breakpoint
-- The six categories that were built in until now, as rows the user can rename or remove.
INSERT INTO `position_categories` (`id`, `name`, `sort_order`, `created_at`) VALUES
	('a9ec74a1-16ac-4c4d-a11d-01b71061d647', 'Tactic', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	('b47c3787-4b66-4244-813f-5226dd7747ce', 'Strategy', 2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	('84b9914f-3592-4335-a754-8bebf5faea0e', 'Endgame', 3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	('ef3e8143-01ab-49b3-9e34-9f17629f04f3', 'Opening', 4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	('7c731364-a07d-4b97-ab9e-53e939e6020f', 'Calculation', 5, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	('5879b85a-3d74-4540-b9c9-395a555d6d73', 'Defense', 6, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
--> statement-breakpoint
-- Saves stored the lowercase key ("tactic"); they now hold the category's name.
UPDATE `saved_positions` SET `category` = upper(substr(`category`, 1, 1)) || substr(`category`, 2) WHERE `category` IS NOT NULL;
