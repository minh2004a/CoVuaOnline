const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");

const DB_MODULE_PATH = path.join(__dirname, "..", "db.js");

function loadDbModuleWithPath(dbPath) {
    process.env.CHESS_DB_PATH = dbPath;
    delete require.cache[require.resolve(DB_MODULE_PATH)];
    return require(DB_MODULE_PATH);
}

async function closeDbModule(dbModule) {
    try {
        const db = await dbModule.getDb();
        await db.close();
    } catch {
        // Ignore close failures in tests cleanup.
    }
}

async function withTempDb(run) {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "chess-db-test-"));
    const dbPath = path.join(tempRoot, "test.sqlite");
    const dbModule = loadDbModuleWithPath(dbPath);

    try {
        await dbModule.initDb();
        await run(dbModule);
    } finally {
        await closeDbModule(dbModule);
        delete process.env.CHESS_DB_PATH;
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
}

test("concurrent Google login upsert keeps single account row", async () => {
    await withTempDb(async (dbModule) => {
        const uid = "google-uid-concurrent";
        const attempts = Array.from({ length: 12 }, (_, index) =>
            dbModule.upsertGoogleUser({
                uid,
                email: "user@example.com",
                name: `Concurrent User ${index}`,
                picture: `https://example.com/avatar-${index}.png`,
            }),
        );

        const users = await Promise.all(attempts);
        const userIds = new Set(users.map((user) => user.id));
        assert.equal(userIds.size, 1);

        const db = await dbModule.getDb();
        const row = await db.get(
            "SELECT COUNT(*) AS total FROM users WHERE google_uid = ?",
            [uid],
        );
        assert.equal(row.total, 1);
    });
});

test("concurrent match finalization is idempotent and rates exactly once", async () => {
    await withTempDb(async (dbModule) => {
        const white = await dbModule.upsertGoogleUser({
            uid: "white-user",
            email: "white@example.com",
            name: "White",
        });
        const black = await dbModule.upsertGoogleUser({
            uid: "black-user",
            email: "black@example.com",
            name: "Black",
        });

        const roomId = "ROOM_CONCURRENT_FINALIZE";
        await dbModule.createMatchRecord({
            roomId,
            whiteUserId: white.id,
            blackUserId: black.id,
            timeControlId: "10|0",
            baseSeconds: 600,
            incrementSeconds: 0,
        });

        const [first, second] = await Promise.all([
            dbModule.finalizeMatch({
                roomId,
                result: "white",
                reason: "checkmate",
                moveCount: 42,
            }),
            dbModule.finalizeMatch({
                roomId,
                result: "white",
                reason: "checkmate",
                moveCount: 42,
            }),
        ]);

        const alreadyFinishedCount = [first, second].filter(
            (item) => item.alreadyFinished,
        ).length;
        assert.equal(alreadyFinishedCount, 1);

        const db = await dbModule.getDb();
        const match = await db.get(
            "SELECT result, rated, finished_at FROM matches WHERE room_id = ?",
            [roomId],
        );
        assert.equal(match.result, "white");
        assert.equal(match.rated, 1);
        assert.ok(match.finished_at);

        const players = await db.all(
            "SELECT id, games_played FROM users WHERE id IN (?, ?) ORDER BY id ASC",
            [white.id, black.id],
        );
        assert.deepEqual(
            players.map((player) => player.games_played),
            [1, 1],
        );
    });
});

