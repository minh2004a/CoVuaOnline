const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const { DB_FILE } = require("./db");

const BACKUP_PREFIX = "chess-online-backup-";
const DEFAULT_BACKUP_INTERVAL_HOURS = 24;
const DEFAULT_BACKUP_RETENTION_DAYS = 14;
const DEFAULT_INITIAL_DELAY_MS = 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parsePositiveInteger(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    const normalized = Math.trunc(parsed);
    return normalized > 0 ? normalized : fallback;
}

function isBackupEnabled() {
    const raw = String(process.env.DB_BACKUP_ENABLED || "true")
        .trim()
        .toLowerCase();
    return raw !== "0" && raw !== "false" && raw !== "no";
}

function resolveBackupDir() {
    const configured = process.env.DB_BACKUP_DIR;
    if (!configured || !configured.trim()) {
        return path.join(path.dirname(DB_FILE), "backups");
    }
    return path.isAbsolute(configured)
        ? configured
        : path.join(process.cwd(), configured);
}

function pad2(value) {
    return String(value).padStart(2, "0");
}

function toBackupFilename(date = new Date()) {
    return (
        `${BACKUP_PREFIX}${date.getUTCFullYear()}` +
        `${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}` +
        `-${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}` +
        ".sqlite"
    );
}

function escapeSqliteString(value) {
    return String(value).replace(/'/g, "''");
}

async function backupDatabaseOnce({
    backupDir = resolveBackupDir(),
    retentionDays = parsePositiveInteger(
        process.env.DB_BACKUP_RETENTION_DAYS,
        DEFAULT_BACKUP_RETENTION_DAYS,
    ),
} = {}) {
    if (!fs.existsSync(DB_FILE)) {
        throw new Error(`DB file not found: ${DB_FILE}`);
    }

    fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, toBackupFilename());

    let db = null;
    try {
        db = await open({
            filename: DB_FILE,
            driver: sqlite3.Database,
        });
        await db.exec("PRAGMA busy_timeout = 5000;");
        await db.exec("PRAGMA wal_checkpoint(PASSIVE);");
        await db.exec(`VACUUM INTO '${escapeSqliteString(backupPath)}'`);
    } finally {
        if (db) {
            await db.close();
        }
    }

    pruneOldBackups({ backupDir, retentionDays });
    return backupPath;
}

function pruneOldBackups({
    backupDir = resolveBackupDir(),
    retentionDays = parsePositiveInteger(
        process.env.DB_BACKUP_RETENTION_DAYS,
        DEFAULT_BACKUP_RETENTION_DAYS,
    ),
} = {}) {
    if (!fs.existsSync(backupDir)) return;

    const cutoffMs = Date.now() - retentionDays * MS_PER_DAY;
    const entries = fs
        .readdirSync(backupDir, { withFileTypes: true })
        .filter(
            (entry) =>
                entry.isFile() &&
                entry.name.startsWith(BACKUP_PREFIX) &&
                entry.name.endsWith(".sqlite"),
        );

    for (const entry of entries) {
        const fullPath = path.join(backupDir, entry.name);
        const stats = fs.statSync(fullPath);
        if (stats.mtimeMs < cutoffMs) {
            fs.unlinkSync(fullPath);
        }
    }
}

function startDbBackupScheduler({ logger = console } = {}) {
    if (!isBackupEnabled()) {
        logger.log("[BACKUP] Scheduler disabled (DB_BACKUP_ENABLED=false).");
        return null;
    }

    const settings = {
        backupDir: resolveBackupDir(),
        intervalHours: parsePositiveInteger(
            process.env.DB_BACKUP_INTERVAL_HOURS,
            DEFAULT_BACKUP_INTERVAL_HOURS,
        ),
        retentionDays: parsePositiveInteger(
            process.env.DB_BACKUP_RETENTION_DAYS,
            DEFAULT_BACKUP_RETENTION_DAYS,
        ),
        initialDelayMs: parsePositiveInteger(
            process.env.DB_BACKUP_INITIAL_DELAY_MS,
            DEFAULT_INITIAL_DELAY_MS,
        ),
    };

    let running = false;
    const runNow = async () => {
        if (running) return null;
        running = true;
        try {
            const backupPath = await backupDatabaseOnce({
                backupDir: settings.backupDir,
                retentionDays: settings.retentionDays,
            });
            logger.log(`[BACKUP] Created ${backupPath}`);
            return backupPath;
        } catch (error) {
            logger.error("[BACKUP] Failed:", error.message);
            return null;
        } finally {
            running = false;
        }
    };

    const intervalMs = settings.intervalHours * 60 * 60 * 1000;
    const intervalHandle = setInterval(() => {
        runNow().catch(() => {});
    }, intervalMs);
    if (typeof intervalHandle.unref === "function") {
        intervalHandle.unref();
    }

    const initialHandle = setTimeout(() => {
        runNow().catch(() => {});
    }, settings.initialDelayMs);
    if (typeof initialHandle.unref === "function") {
        initialHandle.unref();
    }

    return {
        settings,
        runNow,
        stop: () => {
            clearInterval(intervalHandle);
            clearTimeout(initialHandle);
        },
    };
}

module.exports = {
    backupDatabaseOnce,
    pruneOldBackups,
    startDbBackupScheduler,
};
