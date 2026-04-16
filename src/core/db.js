import fs from "node:fs";
import path from "node:path";
import { buildErrorFingerprint } from "./error-fingerprint.js";
import { DB_DIR, DB_PATH } from "../shared/constants.js";

let db;
let storageMode = "memory";
let memoryStore = [];
let hasFts = false;
const JSON_FALLBACK_PATH = path.join(DB_DIR, "errors.json");

function ensureDir() {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

function buildFtsQuery(text = "") {
  const tokens = String(text)
    .toLowerCase()
    .split(/[^a-z0-9_]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .slice(0, 8);

  return tokens.join(" OR ");
}

function loadJsonStore() {
  if (fs.existsSync(JSON_FALLBACK_PATH)) {
    try {
      memoryStore = JSON.parse(fs.readFileSync(JSON_FALLBACK_PATH, "utf8"));
    } catch {
      memoryStore = [];
    }
  }
}

function saveJsonStore() {
  fs.writeFileSync(JSON_FALLBACK_PATH, JSON.stringify(memoryStore, null, 2), "utf8");
}

function sortResults(items, os = "", version = "", sort = "best") {
  return [...items].sort((a, b) => {
    const osScoreA = a.os === os && os ? 0 : 1;
    const osScoreB = b.os === os && os ? 0 : 1;
    const versionScoreA = a.openclaw_version === version && version ? 0 : 1;
    const versionScoreB = b.openclaw_version === version && version ? 0 : 1;

    if (sort === "best") {
      if (osScoreA !== osScoreB) return osScoreA - osScoreB;
      if (versionScoreA !== versionScoreB) return versionScoreA - versionScoreB;
    }

    if ((b.votes || 0) !== (a.votes || 0)) return (b.votes || 0) - (a.votes || 0);

    if (sort === "latest") {
      return String(b.created_at).localeCompare(String(a.created_at));
    }

    if (sort === "votes") {
      return String(b.created_at).localeCompare(String(a.created_at));
    }

    return String(b.created_at).localeCompare(String(a.created_at));
  });
}

function getOrderByClause(sort = "best") {
  if (sort === "votes") {
    return "e.votes DESC, e.created_at DESC";
  }

  if (sort === "latest") {
    return "e.created_at DESC, e.votes DESC";
  }

  return `
    CASE WHEN e.os = @os AND @os != '' THEN 0 ELSE 1 END,
    CASE WHEN e.openclaw_version = @version AND @version != '' THEN 0 ELSE 1 END,
    e.votes DESC,
    e.created_at DESC
  `;
}

function createSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      error_pattern TEXT NOT NULL,
      error_fingerprint TEXT NOT NULL,
      command TEXT,
      os TEXT,
      openclaw_version TEXT,
      solution TEXT NOT NULL,
      source TEXT DEFAULT 'llm',
      votes INTEGER DEFAULT 0,
      helpful_count INTEGER DEFAULT 0,
      not_solved_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  try {
    database.exec("ALTER TABLE errors ADD COLUMN helpful_count INTEGER DEFAULT 0;");
  } catch {}

  try {
    database.exec("ALTER TABLE errors ADD COLUMN not_solved_count INTEGER DEFAULT 0;");
  } catch {}

  try {
    database.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS errors_fts USING fts5(
        error_pattern,
        error_fingerprint,
        solution,
        command,
        os,
        openclaw_version
      );
    `);
    hasFts = true;
  } catch {
    hasFts = false;
  }
}

function rebuildFtsIndex(database) {
  if (!hasFts) {
    return;
  }

  const errorCount = database.prepare("SELECT COUNT(*) AS count FROM errors").get().count;
  const ftsCount = database.prepare("SELECT COUNT(*) AS count FROM errors_fts").get().count;

  if (errorCount !== ftsCount) {
    database.exec("DELETE FROM errors_fts;");
    database.prepare(`
      INSERT INTO errors_fts(rowid, error_pattern, error_fingerprint, solution, command, os, openclaw_version)
      SELECT id, error_pattern, error_fingerprint, solution, command, os, openclaw_version FROM errors
    `).run();
  }
}

function getSqliteCount(database) {
  return database.prepare("SELECT COUNT(*) AS count FROM errors").get().count;
}

function insertIntoSqlite(database, record) {
  const stmt = database.prepare(`
    INSERT INTO errors (error_pattern, error_fingerprint, command, os, openclaw_version, solution, source, votes, created_at)
    VALUES (@error_pattern, @error_fingerprint, @command, @os, @openclaw_version, @solution, @source, @votes, @created_at)
  `);
  const result = stmt.run(record);

  if (hasFts) {
    database.prepare(`
      INSERT INTO errors_fts(rowid, error_pattern, error_fingerprint, solution, command, os, openclaw_version)
      VALUES (@id, @error_pattern, @error_fingerprint, @solution, @command, @os, @openclaw_version)
    `).run({
      id: Number(result.lastInsertRowid),
      ...record
    });
  }

  return Number(result.lastInsertRowid);
}

function migrateJsonIntoSqlite(database) {
  if (!memoryStore.length || getSqliteCount(database) > 0) {
    return;
  }

  for (const item of memoryStore) {
    insertIntoSqlite(database, {
      error_pattern: item.error_pattern,
      error_fingerprint: item.error_fingerprint || buildErrorFingerprint(item.error_pattern),
      command: item.command || "",
      os: item.os || "",
      openclaw_version: item.openclaw_version || "",
      solution: item.solution || "",
      source: item.source || "llm",
      votes: item.votes || 0,
      helpful_count: item.helpful_count || 0,
      not_solved_count: item.not_solved_count || 0,
      created_at: item.created_at || new Date().toISOString()
    });
  }
}

export async function initializeDatabase() {
  if (db) {
    return db;
  }

  ensureDir();
  loadJsonStore();

  try {
    const sqlite = await import("node:sqlite");
    const DatabaseSync =
      sqlite.DatabaseSync || sqlite.default?.DatabaseSync || sqlite.default;

    db = new DatabaseSync(DB_PATH);
    db.exec("PRAGMA journal_mode = WAL;");
    createSchema(db);
    migrateJsonIntoSqlite(db);
    rebuildFtsIndex(db);
    storageMode = "sqlite";
  } catch {
    storageMode = "json";
    db = { mode: "json" };
    hasFts = false;
  }

  return db;
}

export function getErrorCount() {
  if (storageMode === "sqlite") {
    return getSqliteCount(db);
  }
  return memoryStore.length;
}

export function insertError({
  error_pattern,
  command = "",
  os = "",
  openclaw_version = "",
  solution,
  source = "llm"
}) {
  const fingerprint = buildErrorFingerprint(error_pattern);
  const record = {
    error_pattern: String(error_pattern).slice(0, 4000),
    error_fingerprint: fingerprint,
    command: String(command || "").slice(0, 500),
    os,
    openclaw_version,
    solution: String(solution || "").slice(0, 10000),
    source,
    votes: 0,
    helpful_count: 0,
    not_solved_count: 0,
    created_at: new Date().toISOString()
  };

  if (storageMode === "sqlite") {
    const id = insertIntoSqlite(db, record);
    return {
      id,
      error_fingerprint: fingerprint
    };
  }

  const id = memoryStore.length ? Math.max(...memoryStore.map((item) => item.id)) + 1 : 1;
  memoryStore.push({ id, ...record });
  saveJsonStore();
  return { id, error_fingerprint: fingerprint };
}

export function voteError(id) {
  if (storageMode === "sqlite") {
    const result = db.prepare("UPDATE errors SET votes = votes + 1 WHERE id = ?").run(id);
    return result.changes > 0;
  }

  const item = memoryStore.find((entry) => entry.id === id);
  if (!item) {
    return false;
  }
  item.votes += 1;
  saveJsonStore();
  return true;
}

export function submitErrorFeedback(id, type) {
  const column = type === "not_solved" ? "not_solved_count" : "helpful_count";

  if (storageMode === "sqlite") {
    const update = db
      .prepare(`UPDATE errors SET ${column} = ${column} + 1 WHERE id = ?`)
      .run(id);

    if (!update.changes) {
      return null;
    }

    return db
      .prepare(
        "SELECT helpful_count, not_solved_count, votes FROM errors WHERE id = ?"
      )
      .get(id);
  }

  const item = memoryStore.find((entry) => entry.id === id);
  if (!item) {
    return null;
  }
  item.helpful_count = Number(item.helpful_count || 0) + (column === "helpful_count" ? 1 : 0);
  item.not_solved_count =
    Number(item.not_solved_count || 0) + (column === "not_solved_count" ? 1 : 0);
  saveJsonStore();
  return {
    helpful_count: Number(item.helpful_count || 0),
    not_solved_count: Number(item.not_solved_count || 0),
    votes: Number(item.votes || 0)
  };
}

export function searchErrors({
  query = "",
  os = "",
  version = "",
  limit = 5,
  sort = "best",
  source = "all",
  sameVersionOnly = false,
  minVotes = 0
}) {
  const fingerprint = buildErrorFingerprint(query);
  const ftsQuery = buildFtsQuery(`${query} ${fingerprint}`);
  const orderBy = getOrderByClause(sort);
  const whereClauses = [];
  const sqliteParams = { limit };

  if (sort === "best") {
    sqliteParams.os = os;
    sqliteParams.version = version;
  }

  if (source !== "all") {
    whereClauses.push("e.source = @source");
    sqliteParams.source = source;
  }

  if (Number(minVotes) > 0) {
    whereClauses.push("e.votes >= @minVotes");
    sqliteParams.minVotes = Number(minVotes);
  }

  if (sameVersionOnly && version) {
    whereClauses.push("e.openclaw_version = @versionExact");
    sqliteParams.versionExact = version;
  }

  const extraWhere = whereClauses.length ? ` AND ${whereClauses.join(" AND ")}` : "";

  if (storageMode === "sqlite" && hasFts && ftsQuery) {
    return db
      .prepare(
        `
        SELECT e.*
        FROM errors_fts f
        JOIN errors e ON e.id = f.rowid
        WHERE errors_fts MATCH @ftsQuery${extraWhere}
        ORDER BY ${orderBy}
        LIMIT @limit
      `
      )
      .all({ ftsQuery, ...sqliteParams });
  }

  if (storageMode === "sqlite") {
    return db
      .prepare(
        `
        SELECT e.*
        FROM errors
        AS e
        WHERE (e.error_pattern LIKE @likeQuery
           OR e.error_fingerprint LIKE @likeFingerprint)${extraWhere}
        ORDER BY ${
          sort === "latest"
            ? "created_at DESC, votes DESC"
            : sort === "votes"
              ? "votes DESC, created_at DESC"
              : `
                CASE WHEN os = @os AND @os != '' THEN 0 ELSE 1 END,
                CASE WHEN openclaw_version = @version AND @version != '' THEN 0 ELSE 1 END,
                votes DESC,
                created_at DESC
              `
        }
        LIMIT @limit
      `
      )
      .all({
        likeQuery: `%${String(query).slice(0, 100)}%`,
        likeFingerprint: `%${fingerprint}%`,
        ...sqliteParams
      });
  }

  const matched = memoryStore.filter((item) => {
    const haystack = `${item.error_pattern}\n${item.error_fingerprint}\n${item.solution}\n${item.command}`.toLowerCase();
    if (!(haystack.includes(String(query).toLowerCase()) || haystack.includes(fingerprint))) {
      return false;
    }

    if (source !== "all" && item.source !== source) {
      return false;
    }

    if (Number(minVotes) > 0 && Number(item.votes || 0) < Number(minVotes)) {
      return false;
    }

    if (sameVersionOnly && version && item.openclaw_version !== version) {
      return false;
    }

    return true;
  });

  return sortResults(matched, os, version, sort).slice(0, limit);
}

export function getStorageMode() {
  return storageMode;
}
