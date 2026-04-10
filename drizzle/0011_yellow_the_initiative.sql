CREATE TABLE `sync_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`runId` varchar(64) NOT NULL,
	`status` enum('running','completed','failed','cancelled') NOT NULL DEFAULT 'running',
	`syncType` enum('manual','auto') NOT NULL DEFAULT 'manual',
	`dateFrom` varchar(10),
	`dateTo` varchar(10),
	`totalChunks` int DEFAULT 0,
	`completedChunks` int DEFAULT 0,
	`failedChunks` int DEFAULT 0,
	`cancelledChunks` int DEFAULT 0,
	`ordersProcessed` int DEFAULT 0,
	`itemsProcessed` int DEFAULT 0,
	`newOrders` int DEFAULT 0,
	`modifiedOrders` int DEFAULT 0,
	`deletedOrders` int DEFAULT 0,
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `sync_runs_id` PRIMARY KEY(`id`),
	CONSTRAINT `sync_runs_runId_unique` UNIQUE(`runId`)
);
--> statement-breakpoint
ALTER TABLE `sync_logs` ADD `runId` varchar(64);--> statement-breakpoint
ALTER TABLE `sync_logs` ADD `chunkIndex` int;