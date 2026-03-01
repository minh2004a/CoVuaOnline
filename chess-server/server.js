/**
 * Chess online server with Google auth + SQLite ratings.
 */

const express = require("express");
const http = require("http");
const cors = require("cors");
const path = require("path");
const { Server } = require("socket.io");
const {
    joinQueue,
    leaveQueue,
    getQueuePosition,
    tryMatch,
    getRoom,
    getRoomForPlayer,
    getRoomForUser,
    closeRoom,
    isPlayerInRoom,
    getOpponent,
    getStats,
} = require("./gameRooms");
const {
    initDb,
    upsertGoogleUser,
    createMatchRecord,
    finalizeMatch,
    getLeaderboard,
} = require("./db");
const {
    isAuthReady,
    getAuthInitError,
    verifyGoogleIdToken,
    getClientFirebaseConfig,
} = require("./firebaseAuth");
const {
    createMatchState,
    applyMove: applyAuthoritativeMove,
    checkTimeout,
    getClockSnapshot,
    getTimeoutDelayMs,
    offerDraw: offerDrawOnState,
    declineDraw: declineDrawOnState,
    acceptDraw: acceptDrawOnState,
    colorToResult,
} = require("./matchState");
const { startDbBackupScheduler } = require("./dbBackup");

const app = express();
const server = http.createServer(app);

const DEFAULT_DEV_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];

function parseAllowedOrigins(rawOrigins) {
    if (!rawOrigins) {
        if (process.env.NODE_ENV === "production") {
            throw new Error(
                "CORS_ORIGIN is required in production and must contain explicit origins.",
            );
        }
        return DEFAULT_DEV_ORIGINS;
    }

    const parsed = rawOrigins
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

    if (parsed.includes("*")) {
        if (process.env.NODE_ENV === "production") {
            throw new Error(
                "CORS_ORIGIN must list explicit origins in production. Wildcard '*' is not allowed.",
            );
        }
        console.warn(
            "[CORS] Wildcard '*' is ignored. Using local development origins instead.",
        );
        return DEFAULT_DEV_ORIGINS;
    }

    return parsed.length > 0 ? parsed : DEFAULT_DEV_ORIGINS;
}

const allowedOrigins = parseAllowedOrigins(process.env.CORS_ORIGIN);

function corsOriginValidator(origin, callback) {
    // Some same-origin or server-to-server calls do not send Origin.
    if (!origin) {
        callback(null, true);
        return;
    }
    if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
    }
    callback(new Error(`CORS blocked for origin: ${origin}`));
}

const io = new Server(server, {
    cors: {
        origin: corsOriginValidator,
        methods: ["GET", "POST"],
    },
});

app.use(
    cors({
        origin: corsOriginValidator,
    }),
);
app.use(express.json());
app.use(express.static(path.join(__dirname, "../chess")));

const socketUsers = new Map(); // socketId -> user profile
const liveMatches = new Map(); // roomId -> { state, finished, timeoutHandle }
let matchmakingInProgress = false;
const MATCHMAKING_TICK_MS = Number(process.env.MATCHMAKING_TICK_MS) || 3000;
const CLOCK_TIMEOUT_BUFFER_MS =
    Number(process.env.CLOCK_TIMEOUT_BUFFER_MS) || 75;

function normalizeRoomId(value) {
    if (typeof value !== "string") return null;
    const normalized = value.trim();
    return normalized || null;
}

function getPlayerColor(room, socketId) {
    if (!room || !socketId) return null;
    if (room.whiteSocketId === socketId) return "w";
    if (room.blackSocketId === socketId) return "b";
    return null;
}

function getLiveMatchRuntime(roomId) {
    return liveMatches.get(roomId) || null;
}

function normalizeWinner(value) {
    if (value === "w" || value === "b") return value;
    return null;
}

function clearRuntimeTimeout(runtime) {
    if (!runtime?.timeoutHandle) return;
    clearTimeout(runtime.timeoutHandle);
    runtime.timeoutHandle = null;
}

async function handleRuntimeTimeout(roomId) {
    const runtime = getLiveMatchRuntime(roomId);
    const room = getRoom(roomId);
    if (!runtime || runtime.finished || !room) return;

    const timeout = checkTimeout(runtime.state, Date.now());
    if (!timeout) {
        scheduleRuntimeTimeout(roomId);
        return;
    }

    await concludeMatch(roomId, {
        winner: timeout.winnerColor,
        result: timeout.result,
        reason: timeout.reason,
    });
}

function scheduleRuntimeTimeout(roomId) {
    const runtime = getLiveMatchRuntime(roomId);
    if (!runtime || runtime.finished) return;

    clearRuntimeTimeout(runtime);
    const delayMs = getTimeoutDelayMs(runtime.state, Date.now());
    if (!Number.isFinite(delayMs)) return;

    runtime.timeoutHandle = setTimeout(() => {
        handleRuntimeTimeout(roomId).catch((error) => {
            console.error(
                `[MATCH] timeout handler failed for room ${roomId}:`,
                error.message,
            );
        });
    }, Math.max(0, Math.trunc(delayMs + CLOCK_TIMEOUT_BUFFER_MS)));
}

function defaultGameOverMessage(reason, room, winner) {
    if (reason === "resign") {
        const winnerName = winner === "w" ? room.whiteName : room.blackName;
        return `${winnerName} wins by resignation.`;
    }
    if (reason === "timeout") {
        const winnerName = winner === "w" ? room.whiteName : room.blackName;
        return `${winnerName} wins on time.`;
    }
    if (reason === "draw") {
        return "Draw agreed.";
    }
    if (reason === "disconnect") {
        const winnerName = winner === "w" ? room.whiteName : room.blackName;
        return `${winnerName} wins (opponent disconnected).`;
    }
    if (reason === "checkmate") {
        const winnerName = winner === "w" ? room.whiteName : room.blackName;
        return `${winnerName} wins by checkmate.`;
    }
    if (reason === "stalemate") {
        return "Game ends in stalemate.";
    }
    if (reason === "disputed") {
        return "Result disputed. This match is not rated.";
    }
    return "Game finished.";
}

async function concludeMatch(roomId, { winner = null, result, reason, message }) {
    const room = getRoom(roomId);
    if (!room) return;

    const runtime = getLiveMatchRuntime(roomId);
    if (!runtime) return;
    if (runtime.finished) return;

    runtime.finished = true;
    clearRuntimeTimeout(runtime);
    liveMatches.set(roomId, runtime);

    const finalWinner = normalizeWinner(winner);
    const finalResult = result || colorToResult(finalWinner);

    try {
        const ratingSummary = await finalizeMatch({
            roomId,
            result: finalResult,
            reason,
            moveCount: runtime.state.moveCount,
        });

        if (ratingSummary && ratingSummary.rated) {
            const whiteUser = socketUsers.get(room.whiteSocketId);
            if (whiteUser) {
                whiteUser.rating = ratingSummary.white.after;
                socketUsers.set(room.whiteSocketId, whiteUser);
            }

            const blackUser = socketUsers.get(room.blackSocketId);
            if (blackUser) {
                blackUser.rating = ratingSummary.black.after;
                socketUsers.set(room.blackSocketId, blackUser);
            }
        }

        io.to(roomId).emit("game_over", {
            reason,
            winner: finalWinner,
            message: message || defaultGameOverMessage(reason, room, finalWinner),
            ratingUpdate:
                ratingSummary && !ratingSummary.alreadyFinished && ratingSummary.rated
                    ? {
                          white: ratingSummary.white,
                          black: ratingSummary.black,
                      }
                    : null,
        });
    } catch (error) {
        console.error(`[MATCH] Failed to finalize room ${roomId}:`, error.message);
        io.to(roomId).emit(
            "error_msg",
            "Server could not save result. Match ended without rating update.",
        );
    } finally {
        closeRoom(roomId);
        liveMatches.delete(roomId);
    }
}

async function startMatchFromQueueEntry(match) {
    const { roomId, white, black, room } = match;
    const whiteSocket = io.sockets.sockets.get(white.socketId);
    const blackSocket = io.sockets.sockets.get(black.socketId);

    if (!whiteSocket || !blackSocket) {
        closeRoom(roomId);
        if (whiteSocket) {
            whiteSocket.emit("error_msg", "Opponent disconnected before start.");
        }
        if (blackSocket) {
            blackSocket.emit("error_msg", "Opponent disconnected before start.");
        }
        return;
    }

    try {
        await createMatchRecord({
            roomId,
            whiteUserId: room.whiteUserId,
            blackUserId: room.blackUserId,
            timeControlId: room.timeControlId,
            baseSeconds: room.baseSeconds,
            incrementSeconds: room.incrementSeconds,
        });
    } catch (error) {
        console.error(`[MATCH] create record failed for ${roomId}:`, error.message);
        closeRoom(roomId);
        whiteSocket.emit("error_msg", "Failed to start ranked match.");
        blackSocket.emit("error_msg", "Failed to start ranked match.");
        return;
    }

    liveMatches.set(roomId, {
        state: createMatchState({
            baseSeconds: room.baseSeconds,
            incrementSeconds: room.incrementSeconds,
        }),
        finished: false,
        timeoutHandle: null,
    });
    const runtime = getLiveMatchRuntime(roomId);
    const clock = runtime
        ? getClockSnapshot(runtime.state, Date.now())
        : {
              enabled: false,
              activeColor: null,
              incrementMs: 0,
              remainingMs: { w: null, b: null },
              serverNowMs: Date.now(),
          };

    whiteSocket.join(roomId);
    blackSocket.join(roomId);

    io.to(white.socketId).emit("game_start", {
        roomId,
        color: "w",
        opponentName: black.name,
        myRating: white.rating,
        opponentRating: black.rating,
        authoritative: true,
        clock,
        timeControl: {
            id: room.timeControlId,
            label: room.timeControlLabel,
            baseSeconds: room.baseSeconds,
            incrementSeconds: room.incrementSeconds,
        },
    });

    io.to(black.socketId).emit("game_start", {
        roomId,
        color: "b",
        opponentName: white.name,
        myRating: black.rating,
        opponentRating: white.rating,
        authoritative: true,
        clock,
        timeControl: {
            id: room.timeControlId,
            label: room.timeControlLabel,
            baseSeconds: room.baseSeconds,
            incrementSeconds: room.incrementSeconds,
        },
    });

    console.log(
        `[MATCH] ${roomId} [${room.timeControlId}]: ${room.whiteName} (W ${room.whiteRating}) vs ${room.blackName} (B ${room.blackRating})`,
    );

    scheduleRuntimeTimeout(roomId);
}

async function processMatchmakingQueue() {
    if (matchmakingInProgress) return;
    matchmakingInProgress = true;

    try {
        while (true) {
            const match = tryMatch();
            if (!match) break;
            // Sequentially start matches to keep DB writes and room state consistent.
            await startMatchFromQueueEntry(match);
        }
    } finally {
        matchmakingInProgress = false;
    }
}

app.get("/api/stats", (req, res) => {
    res.json({
        ...getStats(),
        authReady: isAuthReady(),
    });
});

app.get("/api/client-config", (req, res) => {
    res.json(getClientFirebaseConfig());
});

app.get("/api/leaderboard", async (req, res) => {
    try {
        const leaderboard = await getLeaderboard(req.query.limit || 20);
        res.json({ leaderboard });
    } catch (error) {
        console.error("[API] leaderboard failed:", error.message);
        res.status(500).json({ error: "Failed to load leaderboard" });
    }
});

io.on("connection", (socket) => {
    console.log(`[+] Connected: ${socket.id}`);

    socket.on("authenticate", async ({ idToken } = {}) => {
        try {
            const decoded = await verifyGoogleIdToken(idToken);
            const user = await upsertGoogleUser(decoded);
            socketUsers.set(socket.id, user);
            socket.emit("auth_success", { user });
            console.log(`[AUTH] ${socket.id} -> ${user.displayName} (${user.id})`);
        } catch (error) {
            socket.emit("auth_error", "Google login failed on server.");
            console.error(`[AUTH] ${socket.id} failed:`, error.message);
        }
    });

    socket.on("join_queue", async ({ timeControlId } = {}) => {
        const user = socketUsers.get(socket.id);
        if (!user) {
            socket.emit("auth_required", "Please sign in with Google first.");
            return;
        }

        if (getRoomForPlayer(socket.id)) {
            socket.emit("error_msg", "You are already in a game.");
            return;
        }
        if (getRoomForUser(user.id)) {
            socket.emit(
                "error_msg",
                "Your account is already in another active game.",
            );
            return;
        }

        const added = joinQueue({
            socketId: socket.id,
            userId: user.id,
            name: user.displayName,
            rating: user.rating,
            timeControlId,
        });

        if (!added) {
            socket.emit(
                "error_msg",
                "You are already queued or currently playing on another tab.",
            );
            return;
        }

        socket.emit("queue_joined", {
            position: getQueuePosition(socket.id),
            timeControlId: added.timeControlId,
        });

        await processMatchmakingQueue();
    });

    socket.on("cancel_queue", () => {
        leaveQueue(socket.id);
        socket.emit("queue_cancelled");
    });

    socket.on("move_made", async ({ roomId, move, promoType } = {}) => {
        const normalizedRoomId = normalizeRoomId(roomId);
        if (!normalizedRoomId) return;
        const room = getRoom(normalizedRoomId);
        if (!room) return;
        if (!isPlayerInRoom(normalizedRoomId, socket.id)) return;

        const runtime = getLiveMatchRuntime(normalizedRoomId);
        if (!runtime || runtime.finished) return;

        const playerColor = getPlayerColor(room, socket.id);
        if (!playerColor) return;

        const applied = applyAuthoritativeMove(runtime.state, {
            playerColor,
            move,
            promoType,
            nowMs: Date.now(),
        });

        if (applied.status === "timeout") {
            await concludeMatch(normalizedRoomId, {
                winner: applied.winnerColor,
                result: applied.result,
                reason: applied.reason,
            });
            return;
        }

        if (applied.status === "rejected") {
            socket.emit("move_rejected", {
                code: applied.code,
                message: applied.message,
                clock: applied.clock || getClockSnapshot(runtime.state, Date.now()),
            });
            return;
        }

        io.to(normalizedRoomId).emit("move_applied", {
            move: applied.move,
            promoType: applied.promoType || null,
            playerColor: applied.playerColor,
            clock: applied.clock,
        });

        if (applied.outcome) {
            await concludeMatch(normalizedRoomId, {
                winner: applied.outcome.winnerColor,
                result: applied.outcome.result,
                reason: applied.outcome.reason,
            });
            return;
        }

        scheduleRuntimeTimeout(normalizedRoomId);
    });

    socket.on("offer_draw", async ({ roomId } = {}) => {
        const normalizedRoomId = normalizeRoomId(roomId);
        if (!normalizedRoomId) return;
        const room = getRoom(normalizedRoomId);
        if (!room || !isPlayerInRoom(normalizedRoomId, socket.id)) return;

        const runtime = getLiveMatchRuntime(normalizedRoomId);
        if (!runtime || runtime.finished) return;

        const timeout = checkTimeout(runtime.state, Date.now());
        if (timeout) {
            await concludeMatch(normalizedRoomId, {
                winner: timeout.winnerColor,
                result: timeout.result,
                reason: timeout.reason,
            });
            return;
        }

        const offered = offerDrawOnState(runtime.state, socket.id);
        if (!offered.ok) return;

        const opponent = getOpponent(normalizedRoomId, socket.id);
        if (opponent) io.to(opponent).emit("draw_offered");
    });

    socket.on("decline_draw", async ({ roomId } = {}) => {
        const normalizedRoomId = normalizeRoomId(roomId);
        if (!normalizedRoomId) return;
        const room = getRoom(normalizedRoomId);
        if (!room || !isPlayerInRoom(normalizedRoomId, socket.id)) return;

        const runtime = getLiveMatchRuntime(normalizedRoomId);
        if (!runtime || runtime.finished) return;

        const timeout = checkTimeout(runtime.state, Date.now());
        if (timeout) {
            await concludeMatch(normalizedRoomId, {
                winner: timeout.winnerColor,
                result: timeout.result,
                reason: timeout.reason,
            });
            return;
        }

        const declined = declineDrawOnState(runtime.state, socket.id);
        if (!declined.ok) return;

        io.to(declined.offeredBy).emit("draw_declined");
    });

    socket.on("accept_draw", async ({ roomId } = {}) => {
        const normalizedRoomId = normalizeRoomId(roomId);
        if (!normalizedRoomId) return;
        const room = getRoom(normalizedRoomId);
        if (!room || !isPlayerInRoom(normalizedRoomId, socket.id)) return;

        const runtime = getLiveMatchRuntime(normalizedRoomId);
        if (!runtime || runtime.finished) return;

        const timeout = checkTimeout(runtime.state, Date.now());
        if (timeout) {
            await concludeMatch(normalizedRoomId, {
                winner: timeout.winnerColor,
                result: timeout.result,
                reason: timeout.reason,
            });
            return;
        }

        const accepted = acceptDrawOnState(runtime.state, socket.id);
        if (!accepted.ok) {
            socket.emit("error_msg", "No valid draw offer to accept.");
            return;
        }

        await concludeMatch(normalizedRoomId, {
            winner: accepted.winnerColor,
            result: accepted.result,
            reason: accepted.reason,
        });
    });

    socket.on("resign", async ({ roomId } = {}) => {
        const normalizedRoomId = normalizeRoomId(roomId);
        if (!normalizedRoomId) return;
        const room = getRoom(normalizedRoomId);
        if (!room || !isPlayerInRoom(normalizedRoomId, socket.id)) return;

        const isWhite = room.whiteSocketId === socket.id;
        const winner = isWhite ? "b" : "w";

        await concludeMatch(normalizedRoomId, {
            winner,
            result: colorToResult(winner),
            reason: "resign",
        });
    });

    // Deprecated client event. Timeout is decided by server clock only.
    socket.on("timeout_loss", ({ roomId } = {}) => {
        const normalizedRoomId = normalizeRoomId(roomId);
        if (!normalizedRoomId) return;
        const room = getRoom(normalizedRoomId);
        if (!room || !isPlayerInRoom(normalizedRoomId, socket.id)) return;
    });

    socket.on("leave_game", async ({ roomId } = {}) => {
        const normalizedRoomId = normalizeRoomId(roomId);
        if (!normalizedRoomId) return;
        const room = getRoom(normalizedRoomId);
        if (!room || !isPlayerInRoom(normalizedRoomId, socket.id)) return;

        const isWhite = room.whiteSocketId === socket.id;
        const winner = isWhite ? "b" : "w";

        await concludeMatch(normalizedRoomId, {
            winner,
            result: colorToResult(winner),
            reason: "disconnect",
            message: `${isWhite ? room.whiteName : room.blackName} left the game.`,
        });
    });

    // Deprecated client event. Game end is decided by server move validation.
    socket.on("notify_game_over", ({ roomId } = {}) => {
        const normalizedRoomId = normalizeRoomId(roomId);
        if (!normalizedRoomId) return;
        const room = getRoom(normalizedRoomId);
        if (!room || !isPlayerInRoom(normalizedRoomId, socket.id)) return;
    });

    socket.on("disconnect", async () => {
        console.log(`[-] Disconnected: ${socket.id}`);

        leaveQueue(socket.id);

        const roomId = getRoomForPlayer(socket.id);
        if (roomId) {
            const room = getRoom(roomId);
            if (room) {
                const isWhite = room.whiteSocketId === socket.id;
                const winner = isWhite ? "b" : "w";
                await concludeMatch(roomId, {
                    winner,
                    result: colorToResult(winner),
                    reason: "disconnect",
                    message: `${isWhite ? room.whiteName : room.blackName} disconnected.`,
                });
            }
        }

        socketUsers.delete(socket.id);
    });
});

async function bootstrap() {
    await initDb();

    console.log(`[CORS] Allowed origins: ${allowedOrigins.join(", ")}`);

    const backupScheduler = startDbBackupScheduler();
    if (backupScheduler) {
        const { backupDir, intervalHours, retentionDays } = backupScheduler.settings;
        console.log(
            `[BACKUP] Enabled. Every ${intervalHours}h -> ${backupDir} (retention ${retentionDays} days).`,
        );
    }

    if (!isAuthReady()) {
        const error = getAuthInitError();
        console.warn(
            "[AUTH] Firebase Admin is not ready. Online ranked mode will be disabled.",
        );
        if (error) {
            console.warn(`[AUTH] ${error.message}`);
        }
    }

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`Chess server listening on http://localhost:${PORT}`);
        console.log(`Serving static client from ../chess`);
    });

    setInterval(() => {
        processMatchmakingQueue().catch((error) => {
            console.error("[MATCH] periodic matchmaking failed:", error.message);
        });
    }, MATCHMAKING_TICK_MS);
}

bootstrap().catch((error) => {
    console.error("Server bootstrap failed:", error);
    process.exit(1);
});
