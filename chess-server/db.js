const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");

const DEFAULT_RATING = 300;
const ELO_K_FACTOR = 32;
const DB_FILE =
    process.env.CHESS_DB_PATH ||
    path.join(__dirname, "data", "chess-online.sqlite");

let dbPromise = null;
let writeQueue = Promise.resolve();
const DEFAULT_TIME_CONTROL_ID = "10|0";
const DEFAULT_BASE_SECONDS = 10 * 60;
const DEFAULT_INCREMENT_SECONDS = 0;

function withDbWriteLock(task) {
    const run = writeQueue.then(() => task());
    writeQueue = run.catch(() => {});
    return run;
}

async function ensureMatchesSchema(db) {
    const columns = await db.all("PRAGMA table_info(matches)");
    const existing = new Set(columns.map((column) => column.name));

    if (!existing.has("time_control_id")) {
        await db.exec(`
            ALTER TABLE matches
            ADD COLUMN time_control_id TEXT NOT NULL DEFAULT '${DEFAULT_TIME_CONTROL_ID}'
        `);
    }
    if (!existing.has("base_seconds")) {
        await db.exec(`
            ALTER TABLE matches
            ADD COLUMN base_seconds INTEGER NOT NULL DEFAULT ${DEFAULT_BASE_SECONDS}
        `);
    }
    if (!existing.has("increment_seconds")) {
        await db.exec(`
            ALTER TABLE matches
            ADD COLUMN increment_seconds INTEGER NOT NULL DEFAULT ${DEFAULT_INCREMENT_SECONDS}
        `);
    }
}

function ensureDbDir() {
    const dir = path.dirname(DB_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

async function getDb() {
    if (!dbPromise) {
        ensureDbDir();
        dbPromise = open({
            filename: DB_FILE,
            driver: sqlite3.Database,
        });
    }
    return dbPromise;
}

async function initDb() {
    const db = await getDb();
    await db.exec("PRAGMA foreign_keys = ON;");
    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            google_uid TEXT NOT NULL UNIQUE,
            email TEXT,
            display_name TEXT,
            photo_url TEXT,
            rating INTEGER NOT NULL DEFAULT ${DEFAULT_RATING},
            games_played INTEGER NOT NULL DEFAULT 0,
            wins INTEGER NOT NULL DEFAULT 0,
            losses INTEGER NOT NULL DEFAULT 0,
            draws INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS matches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id TEXT NOT NULL UNIQUE,
            white_user_id INTEGER NOT NULL,
            black_user_id INTEGER NOT NULL,
            result TEXT,
            reason TEXT,
            rated INTEGER NOT NULL DEFAULT 0,
            move_count INTEGER NOT NULL DEFAULT 0,
            white_rating_before INTEGER NOT NULL,
            black_rating_before INTEGER NOT NULL,
            white_rating_after INTEGER,
            black_rating_after INTEGER,
            time_control_id TEXT NOT NULL DEFAULT '${DEFAULT_TIME_CONTROL_ID}',
            base_seconds INTEGER NOT NULL DEFAULT ${DEFAULT_BASE_SECONDS},
            increment_seconds INTEGER NOT NULL DEFAULT ${DEFAULT_INCREMENT_SECONDS},
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            finished_at TEXT,
            FOREIGN KEY (white_user_id) REFERENCES users(id),
            FOREIGN KEY (black_user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS ratings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            match_id INTEGER NOT NULL,
            rating_before INTEGER NOT NULL,
            rating_after INTEGER NOT NULL,
            delta INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (match_id) REFERENCES matches(id)
        );
    `);
    await ensureMatchesSchema(db);
}

function toPublicUser(row) {
    if (!row) return null;
    return {
        id: row.id,
        googleUid: row.google_uid,
        email: row.email,
        displayName: row.display_name || "Player",
        photoUrl: row.photo_url || null,
        rating: row.rating,
        gamesPlayed: row.games_played,
        wins: row.wins,
        losses: row.losses,
        draws: row.draws,
    };
}

async function getUserById(id) {
    const db = await getDb();
    const row = await db.get("SELECT * FROM users WHERE id = ?", [id]);
    return toPublicUser(row);
}

async function upsertGoogleUser(decodedToken) {
    return withDbWriteLock(async () => {
        const db = await getDb();
        const uid = decodedToken?.uid;
        if (!uid) throw new Error("Missing Google uid in token payload.");

        const email = decodedToken.email || null;
        const displayName =
            decodedToken.name || decodedToken.email || "Google Player";
        const photoUrl = decodedToken.picture || null;

        let txStarted = false;
        try {
            await db.run("BEGIN IMMEDIATE TRANSACTION");
            txStarted = true;

            const existing = await db.get(
                "SELECT * FROM users WHERE google_uid = ?",
                [uid],
            );

            if (existing) {
                await db.run(
                    `
                        UPDATE users
                        SET email = ?, display_name = ?, photo_url = ?, updated_at = CURRENT_TIMESTAMP
                        WHERE google_uid = ?
                    `,
                    [email, displayName, photoUrl, uid],
                );
            } else {
                await db.run(
                    `
                        INSERT INTO users (google_uid, email, display_name, photo_url, rating)
                        VALUES (?, ?, ?, ?, ?)
                    `,
                    [uid, email, displayName, photoUrl, DEFAULT_RATING],
                );
            }

            const row = await db.get("SELECT * FROM users WHERE google_uid = ?", [
                uid,
            ]);
            await db.run("COMMIT");
            txStarted = false;
            return toPublicUser(row);
        } catch (error) {
            if (txStarted) {
                try {
                    await db.run("ROLLBACK");
                } catch (rollbackError) {
                    console.error("[DB] rollback failed:", rollbackError.message);
                }
            }
            throw error;
        }
    });
}

async function createMatchRecord({
    roomId,
    whiteUserId,
    blackUserId,
    timeControlId = DEFAULT_TIME_CONTROL_ID,
    baseSeconds = DEFAULT_BASE_SECONDS,
    incrementSeconds = DEFAULT_INCREMENT_SECONDS,
}) {
    return withDbWriteLock(async () => {
        const db = await getDb();
        const white = await db.get(
            "SELECT id, rating FROM users WHERE id = ? LIMIT 1",
            [whiteUserId],
        );
        const black = await db.get(
            "SELECT id, rating FROM users WHERE id = ? LIMIT 1",
            [blackUserId],
        );

        if (!white || !black) {
            throw new Error("Cannot create match: player not found.");
        }

        const normalizedTimeControlId =
            typeof timeControlId === "string" && timeControlId.trim()
                ? timeControlId.trim()
                : DEFAULT_TIME_CONTROL_ID;
        const normalizedBaseSeconds = Number.isFinite(Number(baseSeconds))
            ? Math.max(0, Math.trunc(Number(baseSeconds)))
            : DEFAULT_BASE_SECONDS;
        const normalizedIncrementSeconds = Number.isFinite(Number(incrementSeconds))
            ? Math.max(0, Math.trunc(Number(incrementSeconds)))
            : DEFAULT_INCREMENT_SECONDS;

        const result = await db.run(
            `
                INSERT INTO matches (
                    room_id,
                    white_user_id,
                    black_user_id,
                    white_rating_before,
                    black_rating_before,
                    time_control_id,
                    base_seconds,
                    increment_seconds
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                roomId,
                white.id,
                black.id,
                white.rating,
                black.rating,
                normalizedTimeControlId,
                normalizedBaseSeconds,
                normalizedIncrementSeconds,
            ],
        );

        return {
            matchId: result.lastID,
            whiteRatingBefore: white.rating,
            blackRatingBefore: black.rating,
            timeControlId: normalizedTimeControlId,
            baseSeconds: normalizedBaseSeconds,
            incrementSeconds: normalizedIncrementSeconds,
        };
    });
}

function expectedScore(playerRating, opponentRating) {
    return 1 / (1 + 10 ** ((opponentRating - playerRating) / 400));
}

function calculateElo(whiteRating, blackRating, result) {
    const whiteExpected = expectedScore(whiteRating, blackRating);
    const blackExpected = expectedScore(blackRating, whiteRating);

    let whiteScore = 0;
    let blackScore = 0;
    if (result === "white") {
        whiteScore = 1;
        blackScore = 0;
    } else if (result === "black") {
        whiteScore = 0;
        blackScore = 1;
    } else if (result === "draw") {
        whiteScore = 0.5;
        blackScore = 0.5;
    } else {
        throw new Error(`Unsupported rated result: ${result}`);
    }

    const whiteAfter = Math.round(
        whiteRating + ELO_K_FACTOR * (whiteScore - whiteExpected),
    );
    const blackAfter = Math.round(
        blackRating + ELO_K_FACTOR * (blackScore - blackExpected),
    );
    return {
        whiteAfter,
        blackAfter,
        whiteDelta: whiteAfter - whiteRating,
        blackDelta: blackAfter - blackRating,
    };
}

function shouldBeRated(result) {
    return result === "white" || result === "black" || result === "draw";
}

function buildStatDelta(result) {
    if (result === "white") {
        return {
            white: { wins: 1, losses: 0, draws: 0, gamesPlayed: 1 },
            black: { wins: 0, losses: 1, draws: 0, gamesPlayed: 1 },
        };
    }
    if (result === "black") {
        return {
            white: { wins: 0, losses: 1, draws: 0, gamesPlayed: 1 },
            black: { wins: 1, losses: 0, draws: 0, gamesPlayed: 1 },
        };
    }
    if (result === "draw") {
        return {
            white: { wins: 0, losses: 0, draws: 1, gamesPlayed: 1 },
            black: { wins: 0, losses: 0, draws: 1, gamesPlayed: 1 },
        };
    }
    return {
        white: { wins: 0, losses: 0, draws: 0, gamesPlayed: 0 },
        black: { wins: 0, losses: 0, draws: 0, gamesPlayed: 0 },
    };
}

async function finalizeMatch({ roomId, result, reason, moveCount = 0 }) {
    return withDbWriteLock(async () => {
        const db = await getDb();
        let txStarted = false;

        try {
            await db.run("BEGIN IMMEDIATE TRANSACTION");
            txStarted = true;

            const match = await db.get(
                `
                    SELECT
                        m.*,
                        w.display_name AS white_name,
                        b.display_name AS black_name
                    FROM matches m
                    JOIN users w ON w.id = m.white_user_id
                    JOIN users b ON b.id = m.black_user_id
                    WHERE m.room_id = ?
                    LIMIT 1
                `,
                [roomId],
            );

            if (!match) {
                throw new Error(`Match not found for room ${roomId}`);
            }
            if (match.finished_at) {
                await db.run("COMMIT");
                txStarted = false;
                return {
                    alreadyFinished: true,
                    rated: Boolean(match.rated),
                };
            }

            const rated = shouldBeRated(result);
            let whiteAfter = match.white_rating_before;
            let blackAfter = match.black_rating_before;
            let whiteDelta = 0;
            let blackDelta = 0;

            if (rated) {
                const elo = calculateElo(
                    match.white_rating_before,
                    match.black_rating_before,
                    result,
                );
                whiteAfter = elo.whiteAfter;
                blackAfter = elo.blackAfter;
                whiteDelta = elo.whiteDelta;
                blackDelta = elo.blackDelta;
            }

            await db.run(
                `
                    UPDATE matches
                    SET
                        result = ?,
                        reason = ?,
                        rated = ?,
                        move_count = ?,
                        white_rating_after = ?,
                        black_rating_after = ?,
                        finished_at = CURRENT_TIMESTAMP
                    WHERE room_id = ?
                `,
                [
                    result,
                    reason || null,
                    rated ? 1 : 0,
                    moveCount,
                    whiteAfter,
                    blackAfter,
                    roomId,
                ],
            );

            if (rated) {
                const statDelta = buildStatDelta(result);

                await db.run(
                    `
                        UPDATE users
                        SET
                            rating = ?,
                            games_played = games_played + ?,
                            wins = wins + ?,
                            losses = losses + ?,
                            draws = draws + ?,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                    `,
                    [
                        whiteAfter,
                        statDelta.white.gamesPlayed,
                        statDelta.white.wins,
                        statDelta.white.losses,
                        statDelta.white.draws,
                        match.white_user_id,
                    ],
                );

                await db.run(
                    `
                        UPDATE users
                        SET
                            rating = ?,
                            games_played = games_played + ?,
                            wins = wins + ?,
                            losses = losses + ?,
                            draws = draws + ?,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                    `,
                    [
                        blackAfter,
                        statDelta.black.gamesPlayed,
                        statDelta.black.wins,
                        statDelta.black.losses,
                        statDelta.black.draws,
                        match.black_user_id,
                    ],
                );

                await db.run(
                    `
                        INSERT INTO ratings (user_id, match_id, rating_before, rating_after, delta)
                        VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)
                    `,
                    [
                        match.white_user_id,
                        match.id,
                        match.white_rating_before,
                        whiteAfter,
                        whiteDelta,
                        match.black_user_id,
                        match.id,
                        match.black_rating_before,
                        blackAfter,
                        blackDelta,
                    ],
                );
            }

            await db.run("COMMIT");
            txStarted = false;

            return {
                alreadyFinished: false,
                rated,
                roomId,
                result,
                reason: reason || null,
                moveCount,
                white: {
                    id: match.white_user_id,
                    name: match.white_name || "White",
                    before: match.white_rating_before,
                    after: whiteAfter,
                    delta: whiteDelta,
                },
                black: {
                    id: match.black_user_id,
                    name: match.black_name || "Black",
                    before: match.black_rating_before,
                    after: blackAfter,
                    delta: blackDelta,
                },
            };
        } catch (error) {
            if (txStarted) {
                try {
                    await db.run("ROLLBACK");
                } catch (rollbackError) {
                    console.error("[DB] rollback failed:", rollbackError.message);
                }
            }
            throw error;
        }
    });
}

async function getLeaderboard(limit = 20) {
    const parsed = Number(limit);
    const safeLimit = Number.isFinite(parsed)
        ? Math.min(Math.max(Math.trunc(parsed), 1), 100)
        : 20;
    const db = await getDb();
    const rows = await db.all(
        `
            SELECT
                id,
                display_name,
                photo_url,
                rating,
                games_played,
                wins,
                losses,
                draws
            FROM users
            ORDER BY rating DESC, games_played DESC, id ASC
            LIMIT ?
        `,
        [safeLimit],
    );

    return rows.map((row, index) => ({
        rank: index + 1,
        userId: row.id,
        displayName: row.display_name || "Player",
        photoUrl: row.photo_url || null,
        rating: row.rating,
        gamesPlayed: row.games_played,
        wins: row.wins,
        losses: row.losses,
        draws: row.draws,
    }));
}

module.exports = {
    DB_FILE,
    DEFAULT_RATING,
    ELO_K_FACTOR,
    initDb,
    getDb,
    getUserById,
    upsertGoogleUser,
    createMatchRecord,
    finalizeMatch,
    getLeaderboard,
};
