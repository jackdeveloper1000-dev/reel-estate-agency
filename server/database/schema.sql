-- RealAssets AI – MySQL schema (the server creates/updates this automatically on start-up)
CREATE DATABASE IF NOT EXISTS realassets_ai CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE realassets_ai;

CREATE TABLE IF NOT EXISTS projects (
     id          CHAR(24)     NOT NULL PRIMARY KEY,
     user_id     INT UNSIGNED NULL,
     source_url  TEXT         NULL,
     source      ENUM('url','upload') NOT NULL DEFAULT 'url',
     status      ENUM('scraping','ready','queued','rendering','done','error') NOT NULL DEFAULT 'scraping',
     progress    TINYINT UNSIGNED NOT NULL DEFAULT 0,
     stage       VARCHAR(255) NOT NULL DEFAULT '',
     error       TEXT         NULL,
     details     LONGTEXT     NULL COMMENT 'JSON: title, address, price, agent…',
     settings    LONGTEXT     NULL COMMENT 'JSON: format, transition, grade…',
     music_file  VARCHAR(255) NULL,
     video       LONGTEXT     NULL COMMENT 'JSON: file, poster, duration, width, height, renderedAt',
     created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     INDEX idx_projects_status (status),
     INDEX idx_projects_created (created_at)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS project_images (
     id          CHAR(24)     NOT NULL PRIMARY KEY,
     project_id  CHAR(24)     NOT NULL,
     position    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
     file        VARCHAR(255) NOT NULL,
     source_url  TEXT         NULL,
     width       INT UNSIGNED NULL,
     height      INT UNSIGNED NULL,
     selected    TINYINT(1)   NOT NULL DEFAULT 1,
     INDEX idx_images_project (project_id, position),
     CONSTRAINT fk_images_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS users (
     id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
     name          VARCHAR(100) NOT NULL,
     phone         VARCHAR(20)  NOT NULL UNIQUE COMMENT 'E.164, e.g. +919876543210',
     is_active     TINYINT(1)   NOT NULL DEFAULT 1,
     created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
     last_login_at DATETIME     NULL
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS otp_codes (
     id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
     phone       VARCHAR(20)  NOT NULL,
     purpose     ENUM('signup','login') NOT NULL,
     name        VARCHAR(100) NULL COMMENT 'name given at signup',
     code_hash   CHAR(64)     NOT NULL,
     attempts    TINYINT UNSIGNED NOT NULL DEFAULT 0,
     used        TINYINT(1)   NOT NULL DEFAULT 0,
     expires_at  DATETIME     NOT NULL,
     created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
     INDEX idx_otp_phone (phone, created_at)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payments (
     id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
     user_id             INT UNSIGNED NOT NULL,
     provider            ENUM('razorpay','demo') NOT NULL DEFAULT 'razorpay',
     order_id            VARCHAR(64)  NOT NULL UNIQUE,
     payment_id          VARCHAR(64)  NULL,
     amount              INT UNSIGNED NOT NULL COMMENT 'in paise',
     currency            CHAR(3)      NOT NULL DEFAULT 'INR',
     status              ENUM('created','paid','failed') NOT NULL DEFAULT 'created',
     project_id          CHAR(24)     NULL COMMENT 'film this payment unlocked (NULL = unused credit)',
     created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
     paid_at             DATETIME     NULL,
     INDEX idx_pay_user (user_id, status),
     CONSTRAINT fk_pay_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
