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
let opponentRating = null;
let currentOnlineMatchTimeLabel = null;
let onlineConnectionState = "disconnected";
let drawOfferPending = false;
let drawRequestSent = false;
const DRAW_OFFER_COOLDOWN_MS = 8000;
let drawOfferCooldownUntilMs = 0;
let drawOfferCooldownTimer = null;
let awaitingMoveAck = false;
let myRating = null;

let firebaseInitialized = false;
let firebaseAuthReady = false;
let firebaseAuthInstance = null;
let firebaseCurrentUser = null;
let currentIdToken = null;
let pendingQueuePayload = null;
let firebaseInitPromise = null;

const ONLINE_TIME_CONTROLS = Object.freeze({
    "10|0": Object.freeze({
        id: "10|0",
        label: "10|0",
        baseSeconds: 10 * 60,
        incrementSeconds: 0,
    }),
    "15|5": Object.freeze({
        id: "15|5",
        label: "15|5",
        baseSeconds: 15 * 60,
        incrementSeconds: 5,
    }),
});
const DEFAULT_ONLINE_TIME_CONTROL_ID = "10|0";
let selectedOnlineTimeControlId = DEFAULT_ONLINE_TIME_CONTROL_ID;
let lobbyStartedAtMs = null;
let lobbyElapsedTimer = null;

function getEl(id) {
    return document.getElementById(id);
}

function formatOpponentRating(value) {
    return Number.isFinite(value) ? String(Math.round(value)) : "--";
}

function getOnlineConnectionMeta(state) {
    switch (state) {
        case "connected":
            return { label: "Connected", className: "online-status-conn--connected" };
        case "connecting":
            return { label: "Connecting", className: "online-status-conn--connecting" };
        case "reconnecting":
            return {
                label: "Reconnecting",
                className: "online-status-conn--reconnecting",
            };
        default:
            return {
                label: "Disconnected",
                className: "online-status-conn--disconnected",
            };
    }
}

function renderOnlineStatusCard() {
    const connEl = getEl("online-status-conn");
    const reconnectEl = getEl("online-status-reconnect");
    const opponentEl = getEl("online-status-opponent");
    const eloEl = getEl("online-status-elo");
    const timeEl = getEl("online-status-time");
    if (!connEl || !reconnectEl || !opponentEl || !eloEl || !timeEl) return;

    const connMeta = getOnlineConnectionMeta(onlineConnectionState);
    connEl.textContent = connMeta.label;
    connEl.className = `online-status-conn ${connMeta.className}`;

    reconnectEl.hidden = onlineConnectionState !== "reconnecting";

    opponentEl.textContent = opponentName || "Waiting...";
    eloEl.textContent = formatOpponentRating(opponentRating);
    if (currentOnlineMatchTimeLabel) {
        timeEl.textContent = currentOnlineMatchTimeLabel;
    } else {
        timeEl.textContent = getOnlineTimeControl(selectedOnlineTimeControlId).label;
    }
}

function setOnlineConnectionState(nextState) {
    if (onlineConnectionState === nextState) {
        renderOnlineStatusCard();
        return false;
    }
    onlineConnectionState = nextState;
    renderOnlineStatusCard();
    return true;
}

function updateOnlineTurnStatus(isMyTurn) {
    const turnEl = getEl("online-status-turn");
    if (!turnEl) return;
    const mine = !!isMyTurn;
    turnEl.textContent = mine ? "Your move" : "Opponent move";
    turnEl.classList.toggle("online-status-turn--mine", mine);
}

function normalizeOnlineTimeControlId(value) {
    if (typeof value !== "string") return DEFAULT_ONLINE_TIME_CONTROL_ID;
    const normalized = value.trim();
    if (!normalized) return DEFAULT_ONLINE_TIME_CONTROL_ID;
    return Object.prototype.hasOwnProperty.call(ONLINE_TIME_CONTROLS, normalized)
        ? normalized
        : DEFAULT_ONLINE_TIME_CONTROL_ID;
}

function getOnlineTimeControl(timeControlId) {
    const id = normalizeOnlineTimeControlId(timeControlId);
    return ONLINE_TIME_CONTROLS[id];
}

function setOnlineTimeControlSelection(timeControlId) {
    const normalized = normalizeOnlineTimeControlId(timeControlId);
    selectedOnlineTimeControlId = normalized;

    document.querySelectorAll("[data-online-time]").forEach((btn) => {
        const active = btn.dataset.onlineTime === normalized;
        btn.classList.toggle("online-time-btn--active", active);
        btn.setAttribute("aria-pressed", active ? "true" : "false");
    });

    const selectedEl = getEl("online-selected-time");
    if (selectedEl) {
        selectedEl.textContent = `Time: ${getOnlineTimeControl(normalized).label}`;
    }
    renderOnlineStatusCard();
}

function setLeaderboardLoading() {
    const holder = getEl("leaderboard-list");
    if (!holder) return;

    holder.innerHTML = "";
    for (let i = 0; i < 5; i += 1) {
        const skeleton = document.createElement("div");
        skeleton.className = "leaderboard-skeleton";
        holder.appendChild(skeleton);
    }

    const updated = getEl("leaderboard-updated");
    if (updated) updated.textContent = "Updating...";
}

function updateLeaderboardUpdatedAt(status = "updated") {
    const updated = getEl("leaderboard-updated");
    if (!updated) return;

    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");

    if (status === "error") {
        updated.textContent = `Update failed ${hh}:${mm}`;
        return;
    }
    updated.textContent = `Updated ${hh}:${mm}`;
}

function formatElapsedMs(ms) {
    const safeMs = Math.max(0, Number(ms) || 0);
    const totalSeconds = Math.floor(safeMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function renderLobbyElapsed() {
    const el = getEl("lobby-elapsed");
    if (!el) return;
    if (!lobbyStartedAtMs) {
        el.textContent = "00:00";
        return;
    }
    el.textContent = formatElapsedMs(Date.now() - lobbyStartedAtMs);
}

function startLobbyElapsedTimer() {
    stopLobbyElapsedTimer();
    lobbyStartedAtMs = Date.now();
    renderLobbyElapsed();
    lobbyElapsedTimer = setInterval(renderLobbyElapsed, 1000);
}

function stopLobbyElapsedTimer() {
    if (lobbyElapsedTimer) clearInterval(lobbyElapsedTimer);
    lobbyElapsedTimer = null;
    lobbyStartedAtMs = null;
    renderLobbyElapsed();
}

async function ensureGoogleAuth() {
    if (firebaseAuthReady && firebaseAuthInstance) return true;
    if (firebaseInitPromise) return firebaseInitPromise;

    firebaseInitPromise = (async () => {
        firebaseInitialized = true;

        if (!window.firebase) {
            firebaseAuthReady = false;
            firebaseInitialized = false;
            showOnlineError("Firebase SDK missing. Cannot use Google sign-in.");
            return false;
        }

        try {
            const response = await fetch(`${SERVER_URL}/api/client-config`);
            const payload = await response.json();

            if (!payload?.enabled || !payload?.config) {
                firebaseAuthReady = false;
                firebaseInitialized = false;
                updateAuthPanels(false);
                renderLeaderboard([], "Auth is not configured on server.");
                return false;
            }

            if (!window.firebase.apps.length) {
                window.firebase.initializeApp(payload.config);
            }

            firebaseAuthInstance = window.firebase.auth();
            firebaseAuthReady = false;
            // Make sure we only attach this listener once across retries.
            if (!firebaseAuthInstance.__codexBound) {
                firebaseAuthInstance.__codexBound = true;
                firebaseAuthInstance.onAuthStateChanged(async (user) => {
                    firebaseCurrentUser = user || null;
                    if (!user) {
                        currentIdToken = null;
                        myRating = null;
                        socketAuthed = false;
                        if (socket && socket.connected) socket.disconnect();
                        resetOnlineState();
                        renderOnlineStatusCard();
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
            }

            firebaseAuthReady = true;
            updateAuthPanels(
                Boolean(firebaseAuthInstance.currentUser),
                firebaseAuthInstance.currentUser,
            );
            return true;
        } catch (error) {
            firebaseAuthReady = false;
            firebaseInitialized = false;
            showOnlineError("Cannot initialize Google auth.");
            console.error("[Online] auth init failed:", error);
            return false;
        }
    })();

    try {
        return await firebaseInitPromise;
    } finally {
        firebaseInitPromise = null;
    }
}

function connectSocket() {
    if (socket && socket.connected) return;
    if (socket && !socket.connected) {
        setOnlineConnectionState("connecting");
        socket.connect();
        return;
    }

    setOnlineConnectionState("connecting");
    socket = io(SERVER_URL, {
        transports: ["websocket", "polling"],
    });

    socket.on("connect", () => {
        socketAuthed = false;
        setOnlineConnectionState("connected");
        if (currentIdToken) {
            socket.emit("authenticate", { idToken: currentIdToken });
        }
        console.log("[Online] connected", socket.id);
    });

    socket.on("connect_error", (err) => {
        console.error("[Online] connect_error", err.message);
        if (onlineRoomId) {
            const changed = setOnlineConnectionState("reconnecting");
            if (changed) {
                showOnlineNotification("Network unstable. Reconnecting...", "warning");
            }
            return;
        }
        setOnlineConnectionState("disconnected");
        hideLobbyScreen();
        showOnlineError("Cannot connect to online server.");
    });

    socket.on("disconnect", (reason) => {
        socketAuthed = false;
        if (onlineRoomId || pendingQueueJoin) {
            const changed = setOnlineConnectionState("reconnecting");
            if (changed) {
                showOnlineNotification(
                    "Connection lost. Trying to reconnect...",
                    "warning",
                );
            }
        } else {
            setOnlineConnectionState("disconnected");
        }
        console.warn("[Online] disconnected:", reason);
    });

    socket.io.on("reconnect_attempt", () => {
        setOnlineConnectionState("reconnecting");
    });

    socket.io.on("reconnect_failed", () => {
        setOnlineConnectionState("disconnected");
    });

    socket.io.on("reconnect", () => {
        setOnlineConnectionState("connected");
    });

    socket.on("auth_success", ({ user }) => {
        socketAuthed = true;
        if (user) {
            myRating = user.rating;
            updateAuthPanels(true, firebaseCurrentUser, user);
        }

        if (pendingQueueJoin) {
            pendingQueueJoin = false;
            const payload = pendingQueuePayload || {
                timeControlId: selectedOnlineTimeControlId,
            };
            pendingQueuePayload = null;
            socket.emit("join_queue", payload);
        }
    });

    socket.on("auth_error", (msg) => {
        socketAuthed = false;
        pendingQueueJoin = false;
        pendingQueuePayload = null;
        hideLobbyScreen();
        showOnlineError(msg || "Authentication failed.");
    });

    socket.on("auth_required", (msg) => {
        socketAuthed = false;
        pendingQueueJoin = false;
        pendingQueuePayload = null;
        hideLobbyScreen();
        showOnlineError(msg || "Google sign-in required.");
    });

    socket.on("queue_joined", ({ timeControlId } = {}) => {
        setOnlineTimeControlSelection(timeControlId || selectedOnlineTimeControlId);
        showLobbyScreen(selectedOnlineTimeControlId);
    });

    socket.on("queue_cancelled", () => {
        pendingQueuePayload = null;
        hideLobbyScreen();
    });

    socket.on(
        "game_start",
        ({
            roomId,
            color,
            opponentName: opName,
            myRating: freshRating,
            opponentRating: opRating,
            clock,
            timeControl,
        }) => {
            onlineRoomId = roomId;
            myOnlineColor = color;
            opponentName = opName;
            opponentRating = Number.isFinite(opRating) ? opRating : null;
            drawRequestSent = false;
            resetDrawOfferCooldown();
            awaitingMoveAck = false;
            setDrawOfferButtonPending(false);

            const appliedTimeControl = timeControl?.id
                ? getOnlineTimeControl(timeControl.id)
                : getOnlineTimeControl(selectedOnlineTimeControlId);
            setOnlineTimeControlSelection(appliedTimeControl.id);
            currentOnlineMatchTimeLabel = appliedTimeControl.label;

            if (Number.isFinite(freshRating)) {
                myRating = freshRating;
                updateAuthPanels(true, firebaseCurrentUser, { rating: myRating });
            }

            setOnlineConnectionState("connected");
            updateOnlineTurnStatus(color === "w");
            renderOnlineStatusCard();

            hideLobbyScreen();
            startOnlineGame(color, opName, appliedTimeControl);
            if (clock && typeof syncOnlineClockFromServer === "function") {
                syncOnlineClockFromServer(clock);
            }
            console.log(
                `[Online] game_start room=${roomId} color=${color} tc=${appliedTimeControl.id}`,
            );
        },
    );

    socket.on("move_applied", ({ move, promoType, playerColor, clock }) => {
        if (!move) return;

        if (playerColor === myOnlineColor) {
            awaitingMoveAck = false;
        }

        drawRequestSent = false;
        setDrawOfferButtonPending(false);

        if (typeof applyOnlineMoveFromServer === "function") {
            applyOnlineMoveFromServer(move, promoType || null);
            if (clock && typeof syncOnlineClockFromServer === "function") {
                syncOnlineClockFromServer(clock);
            }
            return;
        }

        lastMove = move;
        selectedSq = null;
        legalMoveSqs = [];
        executeMove(move, promoType || null);
        if (clock && typeof syncOnlineClockFromServer === "function") {
            syncOnlineClockFromServer(clock);
        }
    });

    // Backward-compat event for older servers.
    socket.on("opponent_moved", ({ move, promoType }) => {
        if (!move) return;
        if (typeof applyOnlineMoveFromServer === "function") {
            applyOnlineMoveFromServer(move, promoType || null);
            return;
        }
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
        awaitingMoveAck = false;
        if (typeof ChessClock !== "undefined" && ChessClock?.stop) {
            ChessClock.stop();
        }
        const alreadyOver = state.gameOver;
        const playerColor = myOnlineColor;

        if (reason === "disconnect") {
            if (ratingUpdate) applyRatingUpdate(ratingUpdate, playerColor);
            endOnlineMatchToMenu(message, winner || playerColor);
            return;
        }

        if (!alreadyOver) {
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
        }

        if (ratingUpdate) applyRatingUpdate(ratingUpdate, playerColor);

        resetOnlineState();
        render();
        refreshLeaderboard();
    });

    socket.on("move_rejected", ({ message, clock } = {}) => {
        awaitingMoveAck = false;
        if (clock && typeof syncOnlineClockFromServer === "function") {
            syncOnlineClockFromServer(clock);
        }
        showOnlineNotification(message || "Move rejected by server.", "warning");
    });

    socket.on("error_msg", (msg) => {
        hideLobbyScreen();
        showOnlineError(msg || "Server error.");
    });
}

function applyRatingUpdate(ratingUpdate, playerColor = myOnlineColor) {
    if (playerColor !== "w" && playerColor !== "b") return;
    const side =
        playerColor === "w" ? ratingUpdate.white : ratingUpdate.black;
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

    setLeaderboardLoading();

    try {
        const response = await fetch(`${SERVER_URL}/api/leaderboard?limit=10`);
        if (!response.ok) {
            renderLeaderboard([], "Leaderboard unavailable.");
            updateLeaderboardUpdatedAt("error");
            return;
        }
        const payload = await response.json();
        renderLeaderboard(payload.leaderboard || [], "No rated players yet.");
        updateLeaderboardUpdatedAt("ok");
    } catch (error) {
        console.error("[Online] leaderboard failed:", error);
        renderLeaderboard([], "Leaderboard unavailable.");
        updateLeaderboardUpdatedAt("error");
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
        const rankValue = Number(item.rank) || 0;
        const topClass =
            rankValue === 1
                ? " leaderboard-row--top1"
                : rankValue === 2
                  ? " leaderboard-row--top2"
                  : rankValue === 3
                    ? " leaderboard-row--top3"
                    : "";

        const row = document.createElement("div");
        row.className = `leaderboard-row${topClass}`;

        const rank = document.createElement("span");
        rank.className = "leaderboard-rank";
        rank.textContent =
            rankValue === 1
                ? "🥇 #1"
                : rankValue === 2
                  ? "🥈 #2"
                  : rankValue === 3
                    ? "🥉 #3"
                    : `#${rankValue}`;

        const main = document.createElement("div");
        main.className = "leaderboard-main";

        const name = document.createElement("span");
        name.className = "leaderboard-name";
        name.textContent = String(item.displayName || "Player");

        const sub = document.createElement("span");
        sub.className = "leaderboard-sub";
        const gamesPlayed = Number.isFinite(item.gamesPlayed)
            ? item.gamesPlayed
            : 0;
        sub.textContent = `${gamesPlayed} games`;

        main.append(name, sub);

        const rating = document.createElement("span");
        rating.className = "leaderboard-rating";
        rating.textContent = String(item.rating ?? "-");

        row.append(rank, main, rating);
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
    pendingQueuePayload = {
        timeControlId: selectedOnlineTimeControlId,
    };

    if (socket && socket.connected) {
        if (!socketAuthed) {
            socket.emit("authenticate", { idToken: currentIdToken });
        } else {
            pendingQueueJoin = false;
            const payload = pendingQueuePayload;
            pendingQueuePayload = null;
            socket.emit("join_queue", payload);
        }
    }

    showLobbyScreen(selectedOnlineTimeControlId);
}

// Backward-compatible entrypoint used by chess.js
function joinOnlineQueue() {
    startOnlineMatchmaking();
}

function cancelQueue() {
    pendingQueueJoin = false;
    pendingQueuePayload = null;
    if (socket) socket.emit("cancel_queue");
    hideLobbyScreen();
}

function sendMoveOnline(move, promoType) {
    if (!socket || !onlineRoomId || awaitingMoveAck) return false;
    awaitingMoveAck = true;
    socket.emit("move_made", {
        roomId: onlineRoomId,
        move,
        promoType: promoType || null,
    });
    return true;
}

function isOnlineMovePending() {
    return awaitingMoveAck;
}

function resignOnline() {
    if (!socket || !onlineRoomId) return;
    socket.emit("resign", { roomId: onlineRoomId });
}

function getDrawOfferCooldownRemainingSeconds() {
    const remainingMs = drawOfferCooldownUntilMs - Date.now();
    if (remainingMs <= 0) return 0;
    return Math.ceil(remainingMs / 1000);
}

function stopDrawOfferCooldownTicker() {
    if (!drawOfferCooldownTimer) return;
    clearInterval(drawOfferCooldownTimer);
    drawOfferCooldownTimer = null;
}

function refreshDrawOfferCooldownTicker() {
    if (getDrawOfferCooldownRemainingSeconds() <= 0) {
        stopDrawOfferCooldownTicker();
        return;
    }
    if (drawOfferCooldownTimer) return;
    drawOfferCooldownTimer = setInterval(() => {
        if (getDrawOfferCooldownRemainingSeconds() <= 0) {
            drawOfferCooldownUntilMs = 0;
        }
        setDrawOfferButtonPending(drawRequestSent);
    }, 1000);
}

function renderOnlineActionHint(isPending, cooldownSeconds) {
    const hintEl = getEl("online-actions-hint");
    if (!hintEl) return;

    if (isPending && cooldownSeconds > 0) {
        hintEl.textContent = `Draw offer sent. Retry in ${cooldownSeconds}s if needed.`;
        return;
    }
    if (isPending) {
        hintEl.textContent = "Draw offer sent. Waiting for opponent response.";
        return;
    }
    if (cooldownSeconds > 0) {
        hintEl.textContent = `Draw cooldown: ${cooldownSeconds}s.`;
        return;
    }
    hintEl.textContent = "Draw requests use a short cooldown to avoid spam.";
}

function startDrawOfferCooldown() {
    drawOfferCooldownUntilMs = Date.now() + DRAW_OFFER_COOLDOWN_MS;
    setDrawOfferButtonPending(drawRequestSent);
}

function resetDrawOfferCooldown() {
    drawOfferCooldownUntilMs = 0;
    stopDrawOfferCooldownTicker();
    setDrawOfferButtonPending(drawRequestSent);
}

function offerDrawOnline() {
    if (!socket || !onlineRoomId) return;
    if (drawRequestSent || getDrawOfferCooldownRemainingSeconds() > 0) {
        setDrawOfferButtonPending(drawRequestSent);
        return;
    }

    drawRequestSent = true;
    startDrawOfferCooldown();
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

function notifyGameOverOnline() {
    // Server-authoritative mode: ignore local game-over claims.
}

function reportTimeoutOnline() {
    // Server-authoritative mode: timeout is decided by server clock.
}

function resetOnlineState() {
    onlineRoomId = null;
    myOnlineColor = null;
    opponentName = null;
    opponentRating = null;
    currentOnlineMatchTimeLabel = null;
    drawOfferPending = false;
    drawRequestSent = false;
    awaitingMoveAck = false;
    resetDrawOfferCooldown();
    updateOnlineTurnStatus(false);
    setOnlineConnectionState(socket && socket.connected ? "connected" : "disconnected");
}

function setDrawOfferButtonPending(isPending) {
    const pending = !!isPending;
    const cooldownSeconds = getDrawOfferCooldownRemainingSeconds();
    const onCooldown = cooldownSeconds > 0;
    const btn = getEl("btn-offer-draw");
    if (btn) {
        btn.disabled = pending || onCooldown;
        btn.classList.toggle("btn--cooldown", onCooldown);
        if (pending && onCooldown) {
            btn.textContent = `Draw sent (${cooldownSeconds}s)`;
        } else if (pending) {
            btn.textContent = "Draw offer sent";
        } else if (onCooldown) {
            btn.textContent = `Offer draw (${cooldownSeconds}s)`;
        } else {
            btn.textContent = "Offer draw";
        }
    }
    renderOnlineActionHint(pending, cooldownSeconds);
    refreshDrawOfferCooldownTicker();
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

function showLobbyScreen(timeControlId) {
    const lobby = getEl("lobby-screen");
    if (lobby) lobby.hidden = false;
    startLobbyElapsedTimer();

    const menu = getEl("game-menu");
    if (menu) menu.hidden = true;

    const tc = getOnlineTimeControl(timeControlId || selectedOnlineTimeControlId);
    const lobbyTc = getEl("lobby-time-control");
    if (lobbyTc) {
        lobbyTc.textContent = `Ranked ${tc.label}`;
    }
}

function hideLobbyScreen() {
    const lobby = getEl("lobby-screen");
    if (lobby) lobby.hidden = true;
    stopLobbyElapsedTimer();
}

function showOnlineError(msg) {
    hideLobbyScreen();
    setOnlineConnectionState("disconnected");
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

    document.querySelectorAll("[data-online-time]").forEach((btn) => {
        btn.addEventListener("click", () => {
            setOnlineTimeControlSelection(btn.dataset.onlineTime);
        });
    });

    setOnlineTimeControlSelection(selectedOnlineTimeControlId);
}

bindOnlineUiEvents();
setOnlineConnectionState("disconnected");
updateOnlineTurnStatus(false);
ensureGoogleAuth();
refreshLeaderboard();
