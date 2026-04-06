CREATE TABLE `currency_rates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`date` varchar(10) NOT NULL,
	`currency` varchar(5) NOT NULL,
	`rate` decimal(10,4) NOT NULL,
	`source` varchar(20) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `currency_rates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `order_items` ADD `fixedRate` decimal(10,4);--> statement-breakpoint
ALTER TABLE `order_items` ADD `fixedRateDate` varchar(10);