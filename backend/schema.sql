CREATE TABLE `users` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `password_hash` VARCHAR(255) NULL,
    `email_verified` TINYINT(1) NOT NULL DEFAULT 0,
    `preferences` JSON NULL,
    `created_at` DATETIME NOT NULL,
    `google_id` VARCHAR(64) NULL,
    `token_version` INT UNSIGNED NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_users_email` (`email`),
    UNIQUE KEY `uq_users_google_id` (`google_id`)
);

CREATE TABLE `email_otps` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `code_hash` CHAR(64) NOT NULL,
    `attempts` TINYINT UNSIGNED NOT NULL DEFAULT 0,
    `created_at` DATETIME NOT NULL,
    `expires_at` DATETIME NOT NULL,

    PRIMARY KEY (`id`),
    KEY `idx_email_otps_user_id` (`user_id`),
    KEY `idx_email_otps_expires_at` (`expires_at`)
);

CREATE TABLE `login_history` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `ip` VARCHAR(45) NULL,
    `user_agent` VARCHAR(255) NULL,
    `time_zone` VARCHAR(64) NULL,
    `created_at` DATETIME NOT NULL,

    PRIMARY KEY (`id`),
    KEY `idx_login_history_user_id` (`user_id`)
);

CREATE TABLE `api_keys` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `prefix` VARCHAR(16) NOT NULL,
    `key_hash` CHAR(64) NOT NULL,
    `status` ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
    `request_count` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `last_used_at` DATETIME NULL,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (`id`),
    KEY `idx_api_keys_user_id` (`user_id`),
    UNIQUE KEY `uq_api_keys_key_hash` (`key_hash`)
);

CREATE TABLE `balances` (
    `user_id` BIGINT UNSIGNED NOT NULL,
    `balance` DECIMAL(18,6) NOT NULL DEFAULT 0.000000,
    `currency` VARCHAR(10) NOT NULL DEFAULT 'USD',
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    `tokens_consumed` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `tokens_granted` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `total_requests` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `total_spend` DECIMAL(18,6) NOT NULL DEFAULT 0.000000,

    PRIMARY KEY (`user_id`)
);

CREATE TABLE `balance_transactions` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `reason` VARCHAR(64) NOT NULL,
    `amount` DECIMAL(18,6) NOT NULL DEFAULT 0.000000,
    `tokens` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `balance_after` DECIMAL(18,6) NOT NULL DEFAULT 0.000000,
    `request_id` VARCHAR(100) NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (`id`),
    KEY `idx_balance_transactions_user_id` (`user_id`),
    KEY `idx_balance_transactions_request_id` (`request_id`)
);

CREATE TABLE `models` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `model_id` VARCHAR(150) NOT NULL,
    `active` TINYINT(1) NOT NULL DEFAULT 1,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    `price_prompt_per_1m` DECIMAL(12,6) NOT NULL DEFAULT 0.000000,
    `price_completion_per_1m` DECIMAL(12,6) NOT NULL DEFAULT 0.000000,

    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_models_model_id` (`model_id`)
);

CREATE TABLE `orders` (
    `id` VARCHAR(40) NOT NULL,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `idempotency_key` VARCHAR(64) NULL,
    `package_id` VARCHAR(32) NULL,
    `tokens` BIGINT UNSIGNED NOT NULL,
    `amount_cents` INT UNSIGNED NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'USD',
    `created_at` DATETIME NOT NULL,

    PRIMARY KEY (`id`),
    KEY `idx_orders_user_id` (`user_id`)
);

CREATE TABLE `usage_daily` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `day` DATE NOT NULL,
    `requests` INT UNSIGNED NOT NULL DEFAULT 0,
    `tokens` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `spend` DECIMAL(18,6) NOT NULL DEFAULT 0.000000,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (`id`),
    KEY `idx_usage_daily_user_id` (`user_id`),
    KEY `idx_usage_daily_day` (`day`)
);

CREATE TABLE `usage_requests` (
    `id` VARCHAR(100) NOT NULL,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `model_id` BIGINT UNSIGNED NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'success',
    `tokens` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `latency_ms` INT UNSIGNED NOT NULL DEFAULT 0,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `prompt_tokens` INT NOT NULL DEFAULT 0,
    `completion_tokens` INT NOT NULL DEFAULT 0,
    `cost` DECIMAL(18,6) NOT NULL DEFAULT 0.000000,
    `key_id` BIGINT NULL,

    PRIMARY KEY (`id`),
    KEY `idx_usage_requests_user_id` (`user_id`),
    KEY `idx_usage_requests_model_id` (`model_id`),
    KEY `idx_usage_requests_created_at` (`created_at`)
);