-- RealAssets AI – MySQL schema (the server creates this automatically on start-up)
CREATE DATABASE IF NOT EXISTS realassets_ai CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE realassets_ai;

CREATE TABLE IF NOT EXISTS projects (
     id          CHAR(24)     NOT NULL PRIMARY KEY,
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
