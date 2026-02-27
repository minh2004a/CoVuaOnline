/**
 * ================================================
 * ONLINE.JS – Socket.IO Client for Chess Online
 * Handles connection, matchmaking, and move sync
 * ================================================
 */

// ── Config ──────────────────────────────────────
// Change this URL when deploying to production
const SERVER_URL = "http://localhost:3000";

// ── State ────────────────────────────────────────
let socket = null;
let onlineRoomId = null;
let myOnlineColor = null; // "w" or "b"
let opponentName = null;
let drawOfferPending = false;

// ── Connect ──────────────────────────────────────
function connectSocket() {
    if (socket && socket.connected) return;

    socket = io(SERVER_URL, { transports: ["websocket", "polling"] });

    socket.on("connect", () => {
        console.log("[Online] Connected:", socket.id);
    });

    socket.on("connect_error", (err) => {
        console.error("[Online] Connection error:", err.message);
        showOnlineError("Không thể kết nối server. Kiểm tra lại kết nối mạng.");
    });

    // ── Matched! ──────────────────────────────────
    socket.on("game_start", ({ roomId, color, opponentName: opName }) => {
        onlineRoomId = roomId;
        myOnlineColor = color;
        opponentName = opName;

        hideLobbyScreen();
        startOnlineGame(color, opName);
        console.log(`[Online] Game started in room ${roomId} as ${color}`);
    });

    // ── Opponent moved ────────────────────────────
    socket.on("opponent_moved", ({ move, promoType }) => {
        // Apply the opponent's move on our board
        lastMove = move;
        selectedSq = null;
        legalMoveSqs = [];
        executeMove(move, promoType || null);
    });

    // ── Game over (from server or opponent) ───────
    socket.on("game_over", ({ reason, winner, message }) => {
        if (state.gameOver) return; // already handled locally

        state.gameOver = true;
        state.winner = winner;

        if (reason === "resign" || reason === "disconnect") {
            // Show message
            showOnlineGameOver(winner, message);
        } else if (reason === "draw") {
            showOnlineGameOver(null, message || "Hòa cờ!");
        }
        render();
    });

    // ── Disconnect ────────────────────────────────
    socket.on("opponent_disconnected", ({ message }) => {
        showOnlineNotification("⚠️ " + message, "warning");
        state.gameOver = true;
        state.winner = myOnlineColor;
        render();
    });

    // ── Draw events ──────────────────────────────
    socket.on("draw_offered", () => {
        drawOfferPending = true;
        showDrawOffer();
    });

    socket.on("draw_declined", () => {
        showOnlineNotification("Đối thủ từ chối hòa.", "info");
    });

    // ── Queue feedback ────────────────────────────
    socket.on("queue_joined", () => {
        showLobbyScreen();
    });

    socket.on("queue_cancelled", () => {
        hideLobbyScreen();
    });

    socket.on("error_msg", (msg) => {
        showOnlineError(msg);
    });
}

// ── Join matchmaking queue ───────────────────────
function joinOnlineQueue(playerName) {
    connectSocket();
    showLobbyScreen();
    socket.emit("join_queue", { name: playerName || "Ẩn danh" });
}

// ── Cancel queue ─────────────────────────────────
function cancelQueue() {
    if (socket) socket.emit("cancel_queue");
    hideLobbyScreen();
}

// ── Send move to server ──────────────────────────
function sendMoveOnline(move, promoType) {
    if (!socket || !onlineRoomId) return;
    socket.emit("move_made", {
        roomId: onlineRoomId,
        move,
        promoType: promoType || null,
    });
}

// ── Resign ───────────────────────────────────────
function resignOnline() {
    if (!socket || !onlineRoomId) return;
    socket.emit("resign", { roomId: onlineRoomId });
    onlineRoomId = null;
}

// ── Offer draw ───────────────────────────────────
function offerDrawOnline() {
    if (!socket || !onlineRoomId) return;
    socket.emit("offer_draw", { roomId: onlineRoomId });
    showOnlineNotification("Đã gửi đề nghị hòa cho đối thủ.", "info");
}

// ── Accept / decline draw ────────────────────────
function acceptDraw() {
    if (!socket || !onlineRoomId) return;
    socket.emit("accept_draw", { roomId: onlineRoomId });
    hideDrawOffer();
}

function declineDraw() {
    if (!socket || !onlineRoomId) return;
    socket.emit("decline_draw", { roomId: onlineRoomId });
    drawOfferPending = false;
    hideDrawOffer();
}

// ── Notify server of local game over ─────────────
function notifyGameOverOnline(winner, reason) {
    if (!socket || !onlineRoomId) return;
    socket.emit("notify_game_over", {
        roomId: onlineRoomId,
        winner,
        reason,
    });
    onlineRoomId = null;
}

// ── Reset online state ───────────────────────────
function resetOnlineState() {
    onlineRoomId = null;
    myOnlineColor = null;
    opponentName = null;
    drawOfferPending = false;
}

// ================================================
// UI HELPERS
// ================================================

function showLobbyScreen() {
    const lobby = document.getElementById("lobby-screen");
    if (lobby) lobby.hidden = false;

    // Hide the game menu
    const menu = document.getElementById("game-menu");
    if (menu) menu.hidden = true;
}

function hideLobbyScreen() {
    const lobby = document.getElementById("lobby-screen");
    if (lobby) lobby.hidden = true;
}

function showOnlineError(msg) {
    hideLobbyScreen();
    // Show back the menu with an error notice
    showGameMenu();
    showOnlineNotification("❌ " + msg, "error");
}

function showOnlineNotification(msg, type = "info") {
    // Remove existing
    const old = document.getElementById("online-notification");
    if (old) old.remove();

    const el = document.createElement("div");
    el.id = "online-notification";
    el.className = `online-notification online-notification--${type}`;
    el.textContent = msg;

    // Add close button
    const close = document.createElement("button");
    close.textContent = "✕";
    close.className = "online-notification-close";
    close.onclick = () => el.remove();
    el.appendChild(close);

    document.body.appendChild(el);
    setTimeout(() => el.remove(), 6000);
}

function showDrawOffer() {
    const el = document.getElementById("draw-offer-banner");
    if (el) el.hidden = false;
}

function hideDrawOffer() {
    const el = document.getElementById("draw-offer-banner");
    if (el) el.hidden = true;
    drawOfferPending = false;
}

function showOnlineGameOver(winner, message) {
    const modal = document.getElementById("gameover-modal");
    const titleEl = document.getElementById("gameover-title");
    const msgEl = document.getElementById("gameover-msg");
    const iconEl = document.getElementById("gameover-icon");

    if (winner === myOnlineColor) {
        iconEl.textContent = "🏆";
        titleEl.textContent = "Bạn thắng!";
    } else if (winner && winner !== myOnlineColor) {
        iconEl.textContent = "💀";
        titleEl.textContent = "Bạn thua!";
    } else {
        iconEl.textContent = "🤝";
        titleEl.textContent = "Hòa cờ!";
    }

    msgEl.textContent = message || "";
    modal.hidden = false;
}
