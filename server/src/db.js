/**
 * MySQL connection (works with XAMPP's MySQL/MariaDB and MySQL 8).
 * On start-up it creates the database and tables if they don't exist yet,
 * so there is nothing to import by hand.
 */
const mysql = require('mysql2/promise');
const { MYSQL } = require('./config');

let pool = null;
let connected = false;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS projects (
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
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS project_images (
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
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

async function connect() {
  const base = { host: MYSQL.host, port: MYSQL.port, user: MYSQL.user, password: MYSQL.password };

  // 1. make sure the database exists
  const admin = await mysql.createConnection(base);
  await admin.query(
    `CREATE DATABASE IF NOT EXISTS \`${MYSQL.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await admin.end();

  // 2. pool for the app
  pool = mysql.createPool({ ...base, database: MYSQL.database, waitForConnections: true, connectionLimit: 10 });

  // 3. tables
  for (const sql of SCHEMA) await pool.query(sql);
  const [[v]] = await pool.query('SELECT VERSION() AS v');
  connected = true;
  return v.v;
}

function getPool() {
  if (!pool) throw Object.assign(new Error('Database not connected'), { status: 503 });
  return pool;
}

async function ping() {
  if (!pool) return (connected = false);
  try {
    await pool.query('SELECT 1');
    connected = true;
  } catch {
    connected = false;
  }
  return connected;
}

module.exports = {
  connect,
  getPool,
  ping,
  isConnected: () => connected,
  close: async () => { if (pool) await pool.end(); },
};
