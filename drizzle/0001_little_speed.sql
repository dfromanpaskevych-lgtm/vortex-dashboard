CREATE TABLE `change_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`vortexOrderId` varchar(32) NOT NULL,
	`changeType` enum('new','modified','deleted') NOT NULL,
	`fieldName` varchar(100),
	`oldValue` text,
	`newValue` text,
	`syncBatchId` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `change_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orderId` int NOT NULL,
	`vortexOrderId` varchar(32) NOT NULL,
	`orderItemId` varchar(32),
	`code` varchar(100),
	`brandName` varchar(100),
	`description` text,
	`status` varchar(30),
	`whName` text,
	`whId` varchar(20),
	`qty` int,
	`price` decimal(12,2),
	`basePrice` decimal(12,2),
	`basePriceCurrency` varchar(10),
	`retailPrice` decimal(12,2),
	`currency` varchar(10),
	`deliveryTime` bigint,
	`realDeliveryTime` bigint,
	`deliveryName` text,
	`clientNote` text,
	`managerNote` text,
	`returnPeriod` varchar(10),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `order_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `order_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`vortexOrderId` varchar(32) NOT NULL,
	`snapshotData` json NOT NULL,
	`syncBatchId` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `order_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`vortexOrderId` varchar(32) NOT NULL,
	`clientId` varchar(32),
	`clientName` text,
	`managerName` text,
	`currency` varchar(10),
	`clientNote` text,
	`managerNote` text,
	`sumUah` decimal(12,2),
	`sumUsd` decimal(12,2),
	`sumEur` decimal(12,2),
	`deliveryProvider` varchar(100),
	`deliveryName` text,
	`customerPhone` varchar(30),
	`trackNumber` varchar(64),
	`cityName` varchar(100),
	`instanceName` text,
	`paymentName` varchar(100),
	`codAmount` decimal(12,2),
	`codCurrency` varchar(10),
	`rawJson` json,
	`createdTs` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`syncedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `orders_vortexOrderId_unique` UNIQUE(`vortexOrderId`)
);
--> statement-breakpoint
CREATE TABLE `sync_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`batchId` varchar(64) NOT NULL,
	`status` enum('running','completed','failed') NOT NULL,
	`ordersProcessed` int DEFAULT 0,
	`itemsProcessed` int DEFAULT 0,
	`newOrders` int DEFAULT 0,
	`modifiedOrders` int DEFAULT 0,
	`deletedOrders` int DEFAULT 0,
	`errorMessage` text,
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `sync_logs_id` PRIMARY KEY(`id`),
	CONSTRAINT `sync_logs_batchId_unique` UNIQUE(`batchId`)
);
