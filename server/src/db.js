/**
 * MySQL connection (works with XAMPP's MySQL/MariaDB and MySQL 8).
 * On start-up it creates the database and tables if they don't exist yet,
 * so there is nothing to import by hand.
 */
const mysql = require('mysql2/promise');
const { MYSQL } = require('./config');

let pool = null;
let connected = false;

const COLLATION = 'utf8mb4_general_ci';
const TABLES = ['projects', 'project_images', 'users', 'otp_codes', 'payments'];

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
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=${COLLATION}`,
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
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=${COLLATION}`,
  `CREATE TABLE IF NOT EXISTS users (
     id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
     name          VARCHAR(100) NOT NULL,
     phone         VARCHAR(20)  NOT NULL UNIQUE COMMENT 'E.164, e.g. +919876543210',
     is_active     TINYINT(1)   NOT NULL DEFAULT 1,
     brand_kit     LONGTEXT     NULL COMMENT 'JSON: agentName, agentPhone, agency, cta',
     terms_accepted_at DATETIME NULL,
     created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
     last_login_at DATETIME     NULL
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=${COLLATION}`,
  `CREATE TABLE IF NOT EXISTS otp_codes (
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
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=${COLLATION}`,
  `CREATE TABLE IF NOT EXISTS payments (
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
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=${COLLATION}`,
];

// Columns & collations added/aligned after the first release – updated in place so existing data is kept
async function migrate(pool) {
  const [cols] = await pool.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects'`
  );
  const have = new Set(cols.map((c) => c.COLUMN_NAME));
  if (!have.has('user_id')) {
    await pool.query('ALTER TABLE projects ADD COLUMN user_id INT UNSIGNED NULL AFTER id, ADD INDEX idx_projects_user (user_id)');
  }

  const [userCols] = await pool.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'`
  );
  const haveUser = new Set(userCols.map((c) => c.COLUMN_NAME));
  if (!haveUser.has('brand_kit')) {
    await pool.query("ALTER TABLE users ADD COLUMN brand_kit LONGTEXT NULL COMMENT 'JSON: agentName, agentPhone, agency, cta' AFTER is_active");
  }
  if (!haveUser.has('terms_accepted_at')) {
    await pool.query('ALTER TABLE users ADD COLUMN terms_accepted_at DATETIME NULL AFTER brand_kit');
  }

  // Align database + table/column collations to utf8mb4_general_ci (fixes MySQL 8 utf8mb4_0900_ai_ci mismatch)
  const [tbls] = await pool.query(
    `SELECT TABLE_NAME, TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()`
  );
  const [colRows] = await pool.query(
    `SELECT TABLE_NAME, COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLLATION_NAME IS NOT NULL`
  );
  const badSet = new Set();
  for (const r of tbls) {
    if (TABLES.includes(r.TABLE_NAME) && r.TABLE_COLLATION !== COLLATION) badSet.add(r.TABLE_NAME);
  }
  for (const r of colRows) {
    if (TABLES.includes(r.TABLE_NAME) && r.COLLATION_NAME !== COLLATION) badSet.add(r.TABLE_NAME);
  }

  if (badSet.size) {
    const conn = await pool.getConnection();
    try {
      await conn.query('SET FOREIGN_KEY_CHECKS = 0');
      try {
        await conn.query(`ALTER DATABASE \`${MYSQL.database}\` CHARACTER SET utf8mb4 COLLATE ${COLLATION}`);
      } catch { /* ignore if DB user lacks ALTER DATABASE privilege */ }
      for (const tableName of badSet) {
        await conn.query(`ALTER TABLE \`${tableName}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE ${COLLATION}`);
      }
    } finally {
      await conn.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
      conn.release();
    }
  }
}

async function connect() {
  const base = { host: MYSQL.host, port: MYSQL.port, user: MYSQL.user, password: MYSQL.password };

  // 1. make sure the database exists (ignore privilege error on shared hosts where DB is pre-created)
  try {
    const admin = await mysql.createConnection(base);
    await admin.query(
      `CREATE DATABASE IF NOT EXISTS \`${MYSQL.database}\` CHARACTER SET utf8mb4 COLLATE ${COLLATION}`
    );
    await admin.end();
  } catch (err) {
    if (!['ER_DBACCESS_DENIED_ERROR', 'ER_ACCESS_DENIED_ERROR'].includes(err.code)) throw err;
  }

  // 2. pool for the app (match connection collation to utf8mb4_general_ci)
  pool = mysql.createPool({
    ...base,
    database: MYSQL.database,
    charset: COLLATION,
    waitForConnections: true,
    connectionLimit: 10,
  });

  // 3. tables
  for (const sql of SCHEMA) await pool.query(sql);
  await migrate(pool);
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
