CREATE TABLE `concept_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `concept_categories_name_idx` ON `concept_categories` (`name`);
--> statement-breakpoint
-- The six categories that were built in until now, as rows the user can rename or remove.
INSERT INTO `concept_categories` (`id`, `name`, `sort_order`, `created_at`) VALUES
	('10509c75-0786-491a-9acf-11e50cb5690a', 'Pawn structures', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	('555c02ff-ee29-4b97-bf2d-4f345d59e459', 'Strategic plans', 2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	('058daf0e-9ce4-44dd-b144-957c9b9e9e0a', 'Tactical motifs', 3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	('9bdc26bd-9463-4109-9c76-fa30ee97a460', 'Endgame technique', 4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	('283338be-908d-44dc-856b-355562d631d3', 'Opening ideas', 5, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
	('bc266d99-fe0a-4177-a204-e1134ff164a0', 'Practical play', 6, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
--> statement-breakpoint
-- Concepts stored the key ("tactical_motif"); they now hold the category's name.
UPDATE `concepts` SET `category` = CASE `category`
	WHEN 'pawn_structure' THEN 'Pawn structures'
	WHEN 'strategic_plan' THEN 'Strategic plans'
	WHEN 'tactical_motif' THEN 'Tactical motifs'
	WHEN 'endgame_technique' THEN 'Endgame technique'
	WHEN 'opening_idea' THEN 'Opening ideas'
	WHEN 'practical_play' THEN 'Practical play'
	ELSE `category` END
WHERE `category` IS NOT NULL;
