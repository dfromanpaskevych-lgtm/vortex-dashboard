CREATE TABLE `api_keys` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`keyHash` varchar(128) NOT NULL,
	`keyPrefix` varchar(12) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`lastUsedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `api_keys_id` PRIMARY KEY(`id`),
	CONSTRAINT `api_keys_keyHash_unique` UNIQUE(`keyHash`)
);
--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`url` text NOT NULL,
	`secret` varchar(128) NOT NULL,
	`events` json NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`lastDeliveredAt` timestamp,
	`lastStatus` int,
	`failCount` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `webhooks_id` PRIMARY KEY(`id`)
);
