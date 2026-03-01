/**
 * Socket.IO + Google auth client for online chess.
 */

const DEFAULT_SERVER_URL =
    window.location.protocol.indexOf("http") === 0
        ? window.location.origin
        : "http://localhost:3000";
const SERVER_URL = window.CHESS_SERVER_URL || DEFAULT_SERVER_URL;

let socket = null;
let socketAuthed = false;
let pendingQueueJoin = false;

let onlineRoomId = null;
let myOnlineColor = null;
let opponentName = null;
let drawOfferPending = false;
let drawRequestSent = false;
let gameOverReported = false;
let myRating = null;

let firebaseInitialized = false;
let firebaseAuthReady = false;
let firebaseAuthInstance = null;
let firebaseCurrentUser = null;
let currentIdToken = null;

function getEl(id) {
    return document.getElementById(id);
}

async function ensureGoogleAuth() {
    if (firebaseInitialized) return firebaseAuthReady;
    firebaseInitialized = true;

    if (!window.firebase) {
        firebaseAuthReady = false;
        showOnlineError("Firebase SDK missing. Cannot use Google sign-in.");
        return false;
    }

    try {
        const response = await fetch(`${SERVER_URL}/api/client-config`);
        const payload = await response.json();

        if (!payload?.enabled || !payload?.config) {
            firebaseAuthReady = false;
            updateAuthPanels(false);
            renderLeaderboard([], "Auth is not configured on server.");
            return false;
        }

        if (!window.firebase.apps.length) {
            window.firebase.initializeApp(payload.config);
        }

        firebaseAuthInstance = window.firebase.auth();
        firebaseAuthReady = true;

        firebaseAuthInstance.onAuthStateChanged(async (user) => {
            firebaseCurrentUser = user || null;
            if (!user) {
                currentIdToken = null;
                myRating = null;
                socketAuthed = false;
                if (socket && socket.connected) socket.disconnect();
                updateAuthPanels(false);
                await refreshLeaderboard();
                return;
            }

            currentIdToken = await user.getIdToken();
            updateAuthPanels(true, user);
            connectSocket();
            if (socket && socket.connected) {
                socket.emit("authenticate", { idToken: currentIdToken });
            }
            await refreshLeaderboard();
        });

        updateAuthPanels(Boolean(firebaseAuthInstance.currentUser), firebaseAuthInstance.currentUser);
        return true;
    } catch (error) {
        firebaseAuthReady = false;
        showOnlineError("Cannot initialize Google auth.");
        console.error("[Online] auth init failed:", error);
        return false;
    }
}

function connectSocket() {
    if (socket && socket.connected) return;
    if (socket && !socket.connected) {
        socket.connect();
        return;
    }

    socket = io(SERVER_URL, {
        transports: ["websocket", "polling"],
    });

    socket.on("connect", () => {
        socketAuthed = false;
        if (currentIdToken) {
            socket.emit("authenticate", { idToken: currentIdToken });
        }
        console.log("[Online] connected", socket.id);
    });

    socket.on("connect_error", (err) => {
        console.error("[Online] connect_error", err.message);
        hideLobbyScreen();
        showOnlineError("Cannot connect to online server.");
    });

    socket.on("auth_success", ({ user }) => {
        socketAuthed = true;
        if (user) {
            myRating = user.rating;
            updateAuthPanels(true, firebaseCurrentUser, user);
        }

        if (pendingQueueJoin) {
            pendingQueueJoin = false;
            socket.emit("join_queue");
        }
    });

    socket.on("auth_error", (msg) => {
        socketAuthed = false;
        pendingQueueJoin = false;
        hideLobbyScreen();
        showOnlineError(msg || "Authentication failed.");
    });

    socket.on("auth_required", (msg) => {
        socketAuthed = false;
        pendingQueueJoin = false;
        hideLobbyScreen();
        showOnlineError(msg || "Google sign-in required.");
    });

    socket.on("queue_joined", () => {
        showLobbyScreen();
    });

    socket.on("queue_cancelled", () => {
        hideLobbyScreen();
    });

    socket.on("game_start", ({ roomId, color, opponentName: opName, myRating: freshRating }) => {
        onlineRoomId = roomId;
        myOnlineColor = color;
        opponentName = opName;
        drawRequestSent = false;
        gameOverReported = false;
        setDrawOfferButtonPending(false);

        if (Number.isFinite(freshRating)) {
            myRating = freshRating;
            updateAuthPanels(true, firebaseCurrentUser, { rating: myRating });
        }

        hideLobbyScreen();
        startOnlineGame(color, opName);
        console.log(`[Online] game_start room=${roomId} color=${color}`);
    });

    socket.on("opponent_moved", ({ move, promoType }) => {
        lastMove = move;
        selectedSq = null;
        legalMoveSqs = [];
        executeMove(move, promoType || null);
    });

    socket.on("draw_offered", () => {
        drawOfferPending = true;
        showDrawOffer();
    });

    socket.on("draw_declined", () => {
        drawRequestSent = false;
        setDrawOfferButtonPending(false);
        showOnlineNotification("Opponent declined draw.", "info");
    });

    socket.on("game_over_pending", () => {
        showOnlineNotification("Waiting opponent result confirmation...", "info");
    });

    socket.on("game_over", ({ reason, winner, message, ratingUpdate }) => {
        if (state.gameOver) return;

        if (reason === "disconnect") {
            endOnlineMatchToMenu(message, winner || myOnlineColor);
            if (ratingUpdate) applyRatingUpdate(ratingUpdate);
            return;
        }

        state.gameOver = true;
        state.winner = winner || null;
        hideDrawOffer();

        if (reason === "draw") {
            showOnlineGameOver(null, message || "Draw.");
        } else if (reason === "disputed") {
            showOnlineGameOver(null, message || "Result disputed.");
        } else {
            showOnlineGameOver(winner || null, message || "Game over.");
        }

        if (ratingUpdate) applyRatingUpdate(ratingUpdate);

        resetOnlineState();
        render();
        refreshLeaderboard();
    });

    socket.on("error_msg", (msg) => {
        hideLobbyScreen();
        showOnlineError(msg || "Server error.");
    });
}

function applyRatingUpdate(ratingUpdate) {
    const side = myOnlineColor === "w" ? ratingUpdate.white : ratingUpdate.black;
    if (!side || !Number.isFinite(side.after)) return;

    myRating = side.after;
    updateAuthPanels(true, firebaseCurrentUser, { rating: myRating });

    const sign = side.delta > 0 ? "+" : "";
    showOnlineNotification(
        `Rating: ${side.before} -> ${side.after} (${sign}${side.delta})`,
        side.delta >= 0 ? "info" : "warning",
    );
}

async function refreshLeaderboard() {
    const holder = getEl("leaderboard-list");
    if (!holder) return;

    try {
        const response = await fetch(`${SERVER_URL}/api/leaderboard?limit=10`);
        if (!response.ok) {
            renderLeaderboard([], "Leaderboard unavailable.");
            return;
        }
        const payload = await response.json();
        renderLeaderboard(payload.leaderboard || [], "No rated players yet.");
    } catch (error) {
        console.error("[Online] leaderboard failed:", error);
        renderLeaderboard([], "Leaderboard unavailable.");
    }
}

function renderLeaderboard(items, emptyMessage) {
    const holder = getEl("leaderboard-list");
    if (!holder) return;

    holder.innerHTML = "";
    if (!items.length) {
        const empty = document.createElement("div");
        empty.className = "leaderboard-empty";
        empty.textContent = emptyMessage || "No data.";
        holder.appendChild(empty);
        return;
    }

    items.forEach((item) => {
        const row = document.createElement("div");
        row.className = "leaderboard-row";
        row.innerHTML =
            `<span class="leaderboard-rank">#${item.rank}</span>` +
            `<span class="leaderboard-name">${item.displayName}</span>` +
            `<span class="leaderboard-rating">${item.rating}</span>`;
        holder.appendChild(row);
    });
}

function updateAuthPanels(isLoggedIn, firebaseUser, serverUser) {
    const loggedOutPanel = getEl("online-auth-logged-out");
    const loggedInPanel = getEl("online-auth-logged-in");
    const userNameEl = getEl("online-user-name");
    const userRatingEl = getEl("online-user-rating");
    const userAvatarEl = getEl("online-user-avatar");

    if (loggedOutPanel) loggedOutPanel.hidden = !!isLoggedIn;
    if (loggedInPanel) loggedInPanel.hidden = !isLoggedIn;

    if (!isLoggedIn) {
        if (userNameEl) userNameEl.textContent = "Not signed in";
        if (userRatingEl) userRatingEl.textContent = "Rating: --";
        if (userAvatarEl) userAvatarEl.src = "";
        return;
    }

    const displayName =
        serverUser?.displayName ||
        firebaseUser?.displayName ||
        firebaseUser?.email ||
        "Google Player";

    if (userNameEl) userNameEl.textContent = displayName;

    const ratingValue = Number.isFinite(serverUser?.rating)
        ? serverUser.rating
        : Number.isFinite(myRating)
          ? myRating
          : 300;
    if (userRatingEl) userRatingEl.textContent = `Rating: ${ratingValue}`;

    if (userAvatarEl) {
        userAvatarEl.src =
            serverUser?.photoUrl ||
            firebaseUser?.photoURL ||
            "https://www.gravatar.com/avatar/?d=mp";
    }
}

async function signInGoogle() {
    const ready = await ensureGoogleAuth();
    if (!ready) {
        showOnlineError("Google auth is not configured yet.");
        return;
    }

    try {
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        await firebaseAuthInstance.signInWithPopup(provider);
        showOnlineNotification("Signed in with Google.", "info");
    } catch (error) {
        console.error("[Online] sign in failed:", error);
        showOnlineError("Google sign-in failed.");
    }
}

async function signOutGoogle() {
    if (!firebaseAuthInstance) return;
    try {
        await firebaseAuthInstance.signOut();
        showOnlineNotification("Signed out.", "info");
    } catch (error) {
        console.error("[Online] sign out failed:", error);
        showOnlineError("Sign out failed.");
    }
}

async function startOnlineMatchmaking() {
    const ready = await ensureGoogleAuth();
    if (!ready || !firebaseCurrentUser) {
        showOnlineError("Please sign in with Google first.");
        return;
    }

    try {
        currentIdToken = await firebaseCurrentUser.getIdToken(true);
    } catch (error) {
        showOnlineError("Cannot refresh login token.");
        return;
    }

    connectSocket();
    pendingQueueJoin = true;

    if (socket && socket.connected) {
        if (!socketAuthed) {
            socket.emit("authenticate", { idToken: currentIdToken });
        } else {
            pendingQueueJoin = false;
            socket.emit("join_queue");
        }
    }

    showLobbyScreen();
}

// Backward-compatible entrypoint used by chess.js
function joinOnlineQueue() {
    startOnlineMatchmaking();
}

function cancelQueue() {
    pendingQueueJoin = false;
    if (socket) socket.emit("cancel_queue");
    hideLobbyScreen();
}

function sendMoveOnline(move, promoType) {
    if (!socket || !onlineRoomId) return;
    socket.emit("move_made", {
        roomId: onlineRoomId,
        move,
        promoType: promoType || null,
    });
}

function resignOnline() {
    if (!socket || !onlineRoomId) return;
    socket.emit("resign", { roomId: onlineRoomId });
}

function offerDrawOnline() {
    if (!socket || !onlineRoomId) return;
    if (drawRequestSent) return;

    drawRequestSent = true;
    setDrawOfferButtonPending(true);
    socket.emit("offer_draw", { roomId: onlineRoomId });
    showOnlineNotification("Draw offer sent.", "info");
}

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

function notifyGameOverOnline(winner, reason) {
    if (!socket || !onlineRoomId || gameOverReported) return;
    gameOverReported = true;
    socket.emit("notify_game_over", {
        roomId: onlineRoomId,
        winner,
        reason,
    });
}

function resetOnlineState() {
    onlineRoomId = null;
    myOnlineColor = null;
    opponentName = null;
    drawOfferPending = false;
    drawRequestSent = false;
    gameOverReported = false;
    setDrawOfferButtonPending(false);
}

function setDrawOfferButtonPending(isPending) {
    const btn = getEl("btn-offer-draw");
    if (!btn) return;
    btn.disabled = !!isPending;
    btn.textContent = isPending ? "Draw offer sent" : "Offer draw";
}

function endOnlineMatchToMenu(message, winnerColor) {
    const disconnectMessage = message || "Opponent disconnected. You win.";

    state.gameOver = true;
    state.winner = winnerColor || null;
    hideDrawOffer();
    resetOnlineState();
    render();

    showOnlineNotification(disconnectMessage, "warning");
    if (typeof hideResignOnlineModal === "function") hideResignOnlineModal();
    if (typeof newGame === "function") newGame();
}

function showLobbyScreen() {
    const lobby = getEl("lobby-screen");
    if (lobby) lobby.hidden = false;

    const menu = getEl("game-menu");
    if (menu) menu.hidden = true;
}

function hideLobbyScreen() {
    const lobby = getEl("lobby-screen");
    if (lobby) lobby.hidden = true;
}

function showOnlineError(msg) {
    hideLobbyScreen();
    if (typeof showGameMenu === "function") showGameMenu();
    showOnlineNotification(msg, "error");
}

function showOnlineNotification(msg, type = "info") {
    const old = getEl("online-notification");
    if (old) old.remove();

    const el = document.createElement("div");
    el.id = "online-notification";
    el.className = `online-notification online-notification--${type}`;
    el.textContent = msg;

    const close = document.createElement("button");
    close.textContent = "x";
    close.className = "online-notification-close";
    close.onclick = () => el.remove();
    el.appendChild(close);

    document.body.appendChild(el);
    setTimeout(() => el.remove(), 6000);
}

function showDrawOffer() {
    const el = getEl("draw-offer-banner");
    if (el) el.hidden = false;
}

function hideDrawOffer() {
    const el = getEl("draw-offer-banner");
    if (el) el.hidden = true;
    drawOfferPending = false;
}

function showOnlineGameOver(winner, message) {
    const modal = getEl("gameover-modal");
    const titleEl = getEl("gameover-title");
    const msgEl = getEl("gameover-msg");
    const iconEl = getEl("gameover-icon");

    if (!modal || !titleEl || !msgEl || !iconEl) return;

    if (winner === myOnlineColor) {
        iconEl.textContent = "Win";
        titleEl.textContent = "You won";
    } else if (winner && winner !== myOnlineColor) {
        iconEl.textContent = "Lose";
        titleEl.textContent = "You lost";
    } else {
        iconEl.textContent = "Draw";
        titleEl.textContent = "Draw";
    }

    msgEl.textContent = message || "";
    modal.hidden = false;
}

function bindOnlineUiEvents() {
    const loginBtn = getEl("btn-google-login");
    if (loginBtn) {
        loginBtn.addEventListener("click", signInGoogle);
    }

    const logoutBtn = getEl("btn-google-logout");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", signOutGoogle);
    }
}

bindOnlineUiEvents();
ensureGoogleAuth();
refreshLeaderboard();
