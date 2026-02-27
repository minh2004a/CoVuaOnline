/**
 * ================================================
 * CHESS ONLINE SERVER
 * Node.js + Express + Socket.IO
 * ================================================
 */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");
const {
    joinQueue,
    leaveQueue,
    tryMatch,
    getRoom,
    getRoomForPlayer,
    removePlayer,
    getOpponent,
    getStats,
} = require("./gameRooms");

const app = express();
const server = http.createServer(app);

// Allow all origins for development (restrict in production)
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    },
});

app.use(cors());

// Serve static files from the chess client folder
// Adjust path if you move the client
app.use(express.static(path.join(__dirname, "../chess")));

// Simple health check endpoint
app.get("/api/stats", (req, res) => {
    res.json(getStats());
});

// ================================================
// SOCKET.IO EVENTS
// ================================================
io.on("connection", (socket) => {
    console.log(`[+] Connected: ${socket.id}`);

    // ── join_queue ──────────────────────────────
    // Client sends: { name: string }
    socket.on("join_queue", ({ name } = {}) => {
        console.log(`[Q] ${socket.id} joined queue as "${name}"`);

        const added = joinQueue(socket.id, name);
        if (!added) {
            socket.emit("error_msg", "Bạn đang trong hàng đợi rồi.");
            return;
        }

        // Tell client they are queued
        socket.emit("queue_joined", { position: 1 });

        // Try to match
        const match = tryMatch();
        if (match) {
            const { roomId, white, black } = match;

            // Add both players to the Socket.IO room for easy broadcasting
            const whiteSocket = io.sockets.sockets.get(white.socketId);
            const blackSocket = io.sockets.sockets.get(black.socketId);

            if (whiteSocket) whiteSocket.join(roomId);
            if (blackSocket) blackSocket.join(roomId);

            // Notify white player
            io.to(white.socketId).emit("game_start", {
                roomId,
                color: "w",
                opponentName: black.name,
            });

            // Notify black player
            io.to(black.socketId).emit("game_start", {
                roomId,
                color: "b",
                opponentName: white.name,
            });

            console.log(
                `[MATCH] Room ${roomId}: ${white.name}(W) vs ${black.name}(B)`,
            );
        }
    });

    // ── cancel_queue ────────────────────────────
    socket.on("cancel_queue", () => {
        leaveQueue(socket.id);
        socket.emit("queue_cancelled");
        console.log(`[Q] ${socket.id} left queue`);
    });

    // ── move_made ───────────────────────────────
    // Client sends: { roomId, move, promoType }
    // move: { fr, fc, tr, tc, castling?, enPassant?, promo?, promoPiece? }
    socket.on("move_made", ({ roomId, move, promoType }) => {
        const room = getRoom(roomId);
        if (!room) return;

        // Security: verify the sender is in this room
        if (room.white !== socket.id && room.black !== socket.id) return;

        // Broadcast to opponent
        const opponent = getOpponent(roomId, socket.id);
        if (opponent) {
            io.to(opponent).emit("opponent_moved", { move, promoType });
        }
    });

    // ── resign ──────────────────────────────────
    // Client sends: { roomId }
    socket.on("resign", ({ roomId }) => {
        const room = getRoom(roomId);
        if (!room) return;

        const isWhite = room.white === socket.id;
        const winner = isWhite ? "b" : "w";

        // Notify the entire room
        io.to(roomId).emit("game_over", {
            reason: "resign",
            winner,
            message: `${isWhite ? room.whiteName : room.blackName} đã đầu hàng!`,
        });

        // Cleanup
        removePlayer(socket.id);
        console.log(`[RESIGN] Room ${roomId} ended`);
    });

    // ── offer_draw ──────────────────────────────
    socket.on("offer_draw", ({ roomId }) => {
        const opponent = getOpponent(roomId, socket.id);
        if (opponent) {
            io.to(opponent).emit("draw_offered");
        }
    });

    // ── accept_draw ─────────────────────────────
    socket.on("accept_draw", ({ roomId }) => {
        io.to(roomId).emit("game_over", {
            reason: "draw",
            winner: null,
            message: "Hai người đồng ý hòa cờ!",
        });
        removePlayer(socket.id);
    });

    // ── decline_draw ─────────────────────────────
    socket.on("decline_draw", ({ roomId }) => {
        const opponent = getOpponent(roomId, socket.id);
        if (opponent) {
            io.to(opponent).emit("draw_declined");
        }
    });

    // ── notify_game_over ─────────────────────────
    // When client detects checkmate/stalemate, it notifies server
    socket.on("notify_game_over", ({ roomId, winner, reason }) => {
        const room = getRoom(roomId);
        if (!room) return;

        // Broadcast to both players
        io.to(roomId).emit("game_over", { reason, winner });
        removePlayer(socket.id);
        console.log(`[GAMEOVER] Room ${roomId}, winner: ${winner}`);
    });

    // ── disconnect ──────────────────────────────
    socket.on("disconnect", () => {
        console.log(`[-] Disconnected: ${socket.id}`);

        const roomId = getRoomForPlayer(socket.id);
        if (roomId) {
            const room = getRoom(roomId);
            if (room) {
                const opponent = getOpponent(roomId, socket.id);
                if (opponent) {
                    io.to(opponent).emit("opponent_disconnected", {
                        message: "Đối thủ đã mất kết nối. Bạn thắng!",
                    });
                }
            }
        }

        removePlayer(socket.id);
    });
});

// ================================================
// START SERVER
// ================================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n♟  Chess Online Server running on http://localhost:${PORT}`);
    console.log(`   Serving client from ../chess/`);
    console.log(`   Stats: http://localhost:${PORT}/api/stats\n`);
});
