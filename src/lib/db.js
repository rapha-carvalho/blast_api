const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const config = require("../config");

let db = null;
let insertReportRequestStmt = null;

function hashIp(ip) {
  if (!ip || ip === "unknown") {
    return null;
  }
  return crypto.createHash("sha256").update(ip).digest("hex");
}

function initDb() {
  if (!config.enableDb) {
    return null;
  }
  if (db) {
    return db;
  }

  const dbDir = path.dirname(config.dbPath);
  fs.mkdirSync(dbDir, { recursive: true });

  db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");

  const schemaPath = path.resolve(process.cwd(), "schema.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf8");
  db.exec(schemaSql);

  insertReportRequestStmt = db.prepare(
    `INSERT INTO report_requests (requested_at, client_ip_hash, event_count, source)
     VALUES (?, ?, ?, ?)`
  );

  return db;
}

function recordReportRequest({ clientIp, eventCount, source }) {
  if (!config.enableDb) {
    return;
  }
  const connection = initDb();
  if (!connection || !insertReportRequestStmt) {
    return;
  }

  insertReportRequestStmt.run(
    new Date().toISOString(),
    hashIp(clientIp),
    Number.isFinite(eventCount) ? eventCount : 0,
    source || "unknown"
  );
}

module.exports = {
  initDb,
  recordReportRequest,
};
