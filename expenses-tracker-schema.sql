CREATE DATABASE IF NOT EXISTS `sd2-db`;
USE `sd2-db`;

CREATE TABLE IF NOT EXISTS `Users` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) DEFAULT NULL,
  `email` VARCHAR(255) NOT NULL,
  `password` VARCHAR(255) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `Categories` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `color` CHAR(7) DEFAULT NULL,
  `is_default` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_user_category` (`user_id`, `name`),
  KEY `idx_categories_user` (`user_id`),
  CONSTRAINT `fk_categories_user` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `Expenses` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `category_id` INT DEFAULT NULL,
  `description` VARCHAR(255) DEFAULT NULL,
  `amount` DECIMAL(10,2) NOT NULL,
  `currency` CHAR(3) NOT NULL DEFAULT 'GBR',
  `spent_at` DATETIME NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_expenses_user_date` (`user_id`, `spent_at`),
  KEY `idx_expenses_category` (`category_id`),
  CONSTRAINT `fk_expenses_user` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_expenses_category` FOREIGN KEY (`category_id`) REFERENCES `Categories`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `Budgets` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `category_id` INT DEFAULT NULL,
  `period_start` DATE NOT NULL,
  `period_end` DATE NOT NULL,
  `amount` DECIMAL(10,2) NOT NULL,
  `note` VARCHAR(255) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_budget_period` (`user_id`, `category_id`, `period_start`, `period_end`),
  KEY `idx_budget_user` (`user_id`),
  KEY `idx_budget_category` (`category_id`),
  CONSTRAINT `fk_budget_user` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_budget_category` FOREIGN KEY (`category_id`) REFERENCES `Categories`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


INSERT INTO `Users` (`name`, `email`, `password`) VALUES
('admin', 'admin@gmail.com', '$2a$10$f8BTstV/.xYL5dpOzToZQ.9Z4lDelWROayUa3nu78Jaswf5iRnoYq');

INSERT INTO `Categories` (`user_id`, `name`, `color`, `is_default`) VALUES
(1, 'Groceries', '#4c8bf5', 1),
(1, 'Transport', '#2b9f6b', 1),
(1, 'Eating Out', '#f59e0b', 1),
(1, 'Utilities', '#7c3aed', 1);

INSERT INTO `Expenses` (`user_id`, `category_id`, `description`, `amount`, `currency`, `spent_at`) VALUES
(1, 1, 'Weekly shop', 82.50, 'GBR', '2024-05-12 10:00:00'),
(1, 2, 'Monthly bus pass', 65.00, 'GBR', '2024-05-10 08:30:00'),
(1, 3, 'Dinner with friends', 38.80, 'GBR', '2024-05-09 19:15:00'),
(1, 4, 'Electricity bill', 120.00, 'GBR', '2024-05-05 12:00:00');
