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

const app = express();
const server = http.createServer(app);

const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",")
          .map((item) => item.trim())
          .filter(Boolean)
    : "*";

const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
    },
});

app.use(
    cors({
        origin: allowedOrigins,
    }),
);
app.use(express.json());
app.use(express.static(path.join(__dirname, "../chess")));

const socketUsers = new Map(); // socketId -> user profile
const liveMatches = new Map(); // roomId -> { moveCount, claims: Map, finished }
let matchmakingInProgress = false;
const MATCHMAKING_TICK_MS = Number(process.env.MATCHMAKING_TICK_MS) || 3000;

function normalizeWinner(value) {
    if (value === "w" || value === "b") return value;
    return null;
}

function resultFromWinner(winner) {
    if (winner === "w") return "white";
    if (winner === "b") return "black";
    return "draw";
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

    const runtime =
        liveMatches.get(roomId) ||
        {
            moveCount: 0,
            claims: new Map(),
            finished: false,
        };

    if (runtime.finished) return;
    runtime.finished = true;
    liveMatches.set(roomId, runtime);

    const finalWinner = normalizeWinner(winner);
    const finalResult = result || resultFromWinner(finalWinner);

    try {
        const ratingSummary = await finalizeMatch({
            roomId,
            result: finalResult,
            reason,
            moveCount: runtime.moveCount,
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
        });
    } catch (error) {
        console.error(`[MATCH] create record failed for ${roomId}:`, error.message);
        closeRoom(roomId);
        whiteSocket.emit("error_msg", "Failed to start ranked match.");
        blackSocket.emit("error_msg", "Failed to start ranked match.");
        return;
    }

    liveMatches.set(roomId, {
        moveCount: 0,
        claims: new Map(),
        finished: false,
    });

    whiteSocket.join(roomId);
    blackSocket.join(roomId);

    io.to(white.socketId).emit("game_start", {
        roomId,
        color: "w",
        opponentName: black.name,
        myRating: white.rating,
        opponentRating: black.rating,
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
                "You are already queued (or opened another queued tab).",
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

    socket.on("move_made", ({ roomId, move, promoType }) => {
        const room = getRoom(roomId);
        if (!room) return;
        if (!isPlayerInRoom(roomId, socket.id)) return;

        const runtime = liveMatches.get(roomId);
        if (runtime && !runtime.finished) {
            runtime.moveCount += 1;
        }

        const opponent = getOpponent(roomId, socket.id);
        if (opponent) {
            io.to(opponent).emit("opponent_moved", { move, promoType });
        }
    });

    socket.on("offer_draw", ({ roomId }) => {
        const room = getRoom(roomId);
        if (!room || !isPlayerInRoom(roomId, socket.id)) return;

        const opponent = getOpponent(roomId, socket.id);
        if (opponent) io.to(opponent).emit("draw_offered");
    });

    socket.on("decline_draw", ({ roomId }) => {
        const room = getRoom(roomId);
        if (!room || !isPlayerInRoom(roomId, socket.id)) return;

        const opponent = getOpponent(roomId, socket.id);
        if (opponent) io.to(opponent).emit("draw_declined");
    });

    socket.on("accept_draw", async ({ roomId }) => {
        const room = getRoom(roomId);
        if (!room || !isPlayerInRoom(roomId, socket.id)) return;

        await concludeMatch(roomId, {
            winner: null,
            result: "draw",
            reason: "draw",
        });
    });

    socket.on("resign", async ({ roomId }) => {
        const room = getRoom(roomId);
        if (!room || !isPlayerInRoom(roomId, socket.id)) return;

        const isWhite = room.whiteSocketId === socket.id;
        const winner = isWhite ? "b" : "w";

        await concludeMatch(roomId, {
            winner,
            result: resultFromWinner(winner),
            reason: "resign",
        });
    });

    socket.on("timeout_loss", async ({ roomId, loser } = {}) => {
        const room = getRoom(roomId);
        if (!room || !isPlayerInRoom(roomId, socket.id)) return;

        const senderColor = room.whiteSocketId === socket.id ? "w" : "b";
        if (loser && loser !== senderColor) {
            socket.emit("error_msg", "Invalid timeout payload.");
            return;
        }

        const winner = senderColor === "w" ? "b" : "w";
        await concludeMatch(roomId, {
            winner,
            result: resultFromWinner(winner),
            reason: "timeout",
        });
    });

    socket.on("leave_game", async ({ roomId }) => {
        const room = getRoom(roomId);
        if (!room || !isPlayerInRoom(roomId, socket.id)) return;

        const isWhite = room.whiteSocketId === socket.id;
        const winner = isWhite ? "b" : "w";

        await concludeMatch(roomId, {
            winner,
            result: resultFromWinner(winner),
            reason: "disconnect",
            message: `${isWhite ? room.whiteName : room.blackName} left the game.`,
        });
    });

    socket.on("notify_game_over", async ({ roomId, winner, reason }) => {
        const room = getRoom(roomId);
        if (!room || !isPlayerInRoom(roomId, socket.id)) return;

        const normalizedReason =
            reason === "checkmate" || reason === "stalemate" ? reason : null;
        if (!normalizedReason) {
            socket.emit("error_msg", "Invalid game over reason.");
            return;
        }

        let normalizedWinner = normalizeWinner(winner);
        if (normalizedReason === "stalemate") {
            normalizedWinner = null;
        }
        if (normalizedReason === "checkmate" && !normalizedWinner) {
            socket.emit("error_msg", "Checkmate must include winner.");
            return;
        }

        const runtime =
            liveMatches.get(roomId) ||
            {
                moveCount: 0,
                claims: new Map(),
                finished: false,
            };

        if (runtime.finished) return;
        runtime.claims.set(socket.id, {
            winner: normalizedWinner,
            reason: normalizedReason,
        });
        liveMatches.set(roomId, runtime);

        if (runtime.claims.size < 2) {
            socket.emit("game_over_pending", {
                reason: normalizedReason,
            });
            return;
        }

        const whiteClaim = runtime.claims.get(room.whiteSocketId);
        const blackClaim = runtime.claims.get(room.blackSocketId);

        if (!whiteClaim || !blackClaim) return;

        const matched =
            whiteClaim.reason === blackClaim.reason &&
            whiteClaim.winner === blackClaim.winner;

        if (!matched) {
            await concludeMatch(roomId, {
                winner: null,
                result: "disputed",
                reason: "disputed",
            });
            return;
        }

        await concludeMatch(roomId, {
            winner: whiteClaim.winner,
            result: resultFromWinner(whiteClaim.winner),
            reason: whiteClaim.reason,
        });
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
                    result: resultFromWinner(winner),
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
