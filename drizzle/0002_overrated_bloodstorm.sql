ALTER TABLE `order_items` ADD `supplierName` text;--> statement-breakpoint
ALTER TABLE `order_items` ADD `supplierTotal` decimal(12,2);--> statement-breakpoint
ALTER TABLE `order_items` ADD `supplierCurrency` varchar(10);--> statement-breakpoint
ALTER TABLE `order_items` ADD `rgId` varchar(32);--> statement-breakpoint
ALTER TABLE `order_items` ADD `rgTimestamp` bigint;