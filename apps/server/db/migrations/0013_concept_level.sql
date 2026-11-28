ALTER TABLE `concepts` ADD `level` text;--> statement-breakpoint
-- The starter concepts carried their level as a tag ("basic", "intermediate", "advanced"): it becomes the
-- field, the easiest one where a concept had several.
UPDATE `concepts` SET `level` = (
	SELECT `tags`.`name` FROM `taggings` JOIN `tags` ON `tags`.`id` = `taggings`.`tag_id`
	WHERE `taggings`.`target_type` = 'concept' AND `taggings`.`target_id` = `concepts`.`id`
		AND `tags`.`name` IN ('basic', 'intermediate', 'advanced')
	ORDER BY CASE `tags`.`name` WHEN 'basic' THEN 1 WHEN 'intermediate' THEN 2 ELSE 3 END
	LIMIT 1
);
--> statement-breakpoint
DELETE FROM `taggings` WHERE `target_type` = 'concept'
	AND `tag_id` IN (SELECT `id` FROM `tags` WHERE `name` IN ('basic', 'intermediate', 'advanced'));
--> statement-breakpoint
-- The level tags themselves, unless games or positions still use them.
DELETE FROM `tags` WHERE `name` IN ('basic', 'intermediate', 'advanced')
	AND `id` NOT IN (SELECT `tag_id` FROM `taggings`);
