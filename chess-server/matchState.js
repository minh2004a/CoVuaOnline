const { Chess } = require("chess.js");

const FILES = "abcdefgh";
const VALID_PROMOTIONS = new Set(["q", "r", "b", "n"]);

function oppositeColor(color) {
    return color === "w" ? "b" : "w";
}

function colorToResult(color) {
    if (color === "w") return "white";
    if (color === "b") return "black";
    return "draw";
}

function normalizeNow(nowMs, fallback = Date.now()) {
    const raw = Number(nowMs);
    if (!Number.isFinite(raw)) return fallback;
    return Math.max(0, Math.trunc(raw));
}

function normalizeSeconds(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.trunc(parsed));
}

function coordToSquare(row, col) {
    if (!Number.isInteger(row) || !Number.isInteger(col)) return null;
    if (row < 0 || row > 7 || col < 0 || col > 7) return null;
    return `${FILES[col]}${8 - row}`;
}

function squareToCoord(square) {
    if (typeof square !== "string" || square.length !== 2) return null;

    const file = square.charCodeAt(0) - 97;
    const rank = Number(square[1]);
    if (!Number.isInteger(file) || file < 0 || file > 7) return null;
    if (!Number.isInteger(rank) || rank < 1 || rank > 8) return null;

    return {
        r: 8 - rank,
        c: file,
    };
}

function normalizePromotion(promoType) {
    if (typeof promoType !== "string") return null;
    const normalized = promoType.trim().toLowerCase();
    return VALID_PROMOTIONS.has(normalized) ? normalized : null;
}

function createMatchState({ baseSeconds = 0, incrementSeconds = 0, nowMs } = {}) {
    const baseMs = normalizeSeconds(baseSeconds) * 1000;
    const incrementMs = normalizeSeconds(incrementSeconds) * 1000;
    const startedAt = normalizeNow(nowMs);

    return {
        chess: new Chess(),
        moveCount: 0,
        drawOfferedBy: null,
        clock: {
            enabled: baseMs > 0,
            incrementMs,
            remainingMs: {
                w: baseMs,
                b: baseMs,
            },
            activeColor: "w",
            lastTickAt: startedAt,
        },
    };
}

function projectRemainingMs(matchState, color, nowMs) {
    const clock = matchState?.clock;
    if (!clock?.enabled) return null;

    const now = normalizeNow(nowMs, clock.lastTickAt);
    const stored = clock.remainingMs[color];
    if (!Number.isFinite(stored)) return 0;
    if (clock.activeColor !== color) return Math.max(0, Math.trunc(stored));

    const elapsed = Math.max(0, now - clock.lastTickAt);
    return Math.max(0, Math.trunc(stored - elapsed));
}

function getClockSnapshot(matchState, nowMs = Date.now()) {
    const clock = matchState?.clock;
    if (!clock?.enabled) {
        return {
            enabled: false,
            activeColor: null,
            incrementMs: 0,
            remainingMs: {
                w: null,
                b: null,
            },
            serverNowMs: normalizeNow(nowMs),
        };
    }

    const now = normalizeNow(nowMs, clock.lastTickAt);
    return {
        enabled: true,
        activeColor: clock.activeColor,
        incrementMs: clock.incrementMs,
        remainingMs: {
            w: projectRemainingMs(matchState, "w", now),
            b: projectRemainingMs(matchState, "b", now),
        },
        serverNowMs: now,
    };
}

function advanceClock(matchState, nowMs = Date.now()) {
    const clock = matchState?.clock;
    if (!clock?.enabled || !clock.activeColor) return null;

    const now = normalizeNow(nowMs, clock.lastTickAt);
    const elapsed = Math.max(0, now - clock.lastTickAt);
    if (elapsed > 0) {
        const active = clock.activeColor;
        clock.remainingMs[active] = Math.max(0, clock.remainingMs[active] - elapsed);
        clock.lastTickAt = now;
    }

    if (clock.remainingMs[clock.activeColor] > 0) return null;
    return clock.activeColor;
}

function getTimeoutDelayMs(matchState, nowMs = Date.now()) {
    const clock = matchState?.clock;
    if (!clock?.enabled || !clock.activeColor) return null;
    const snapshot = getClockSnapshot(matchState, nowMs);
    return snapshot.remainingMs[clock.activeColor];
}

function checkTimeout(matchState, nowMs = Date.now()) {
    const loserColor = advanceClock(matchState, nowMs);
    if (!loserColor) return null;

    const winnerColor = oppositeColor(loserColor);
    return {
        loserColor,
        winnerColor,
        reason: "timeout",
        result: colorToResult(winnerColor),
        clock: getClockSnapshot(matchState, nowMs),
    };
}

function normalizeMove(move) {
    if (!move || typeof move !== "object") return null;
    const from = coordToSquare(move.fr, move.fc);
    const to = coordToSquare(move.tr, move.tc);
    if (!from || !to) return null;
    return { from, to };
}

function buildClientMove(moveResult) {
    const from = squareToCoord(moveResult.from);
    const to = squareToCoord(moveResult.to);
    if (!from || !to) return null;

    const flags = typeof moveResult.flags === "string" ? moveResult.flags : "";
    const castling = flags.includes("k") ? "K" : flags.includes("q") ? "Q" : null;
    const promoPiece =
        typeof moveResult.promotion === "string"
            ? moveResult.promotion.toUpperCase()
            : null;

    return {
        fr: from.r,
        fc: from.c,
        tr: to.r,
        tc: to.c,
        enPassant: flags.includes("e"),
        castling,
        promo: Boolean(promoPiece),
        promoPiece,
    };
}

function detectOutcome(chess, lastMoverColor) {
    if (!chess.isGameOver()) return null;

    if (chess.isCheckmate()) {
        return {
            winnerColor: lastMoverColor,
            reason: "checkmate",
            result: colorToResult(lastMoverColor),
        };
    }

    if (chess.isStalemate()) {
        return {
            winnerColor: null,
            reason: "stalemate",
            result: "draw",
        };
    }

    return {
        winnerColor: null,
        reason: "draw",
        result: "draw",
    };
}

function applyMove(matchState, { playerColor, move, promoType, nowMs = Date.now() } = {}) {
    if (playerColor !== "w" && playerColor !== "b") {
        return {
            status: "rejected",
            code: "INVALID_PLAYER",
            message: "Invalid player color.",
        };
    }

    const timeout = checkTimeout(matchState, nowMs);
    if (timeout) {
        return {
            status: "timeout",
            ...timeout,
        };
    }

    const expectedTurn = matchState.chess.turn();
    if (playerColor !== expectedTurn) {
        return {
            status: "rejected",
            code: "NOT_YOUR_TURN",
            message: "It is not your turn.",
            clock: getClockSnapshot(matchState, nowMs),
        };
    }

    const normalizedMove = normalizeMove(move);
    if (!normalizedMove) {
        return {
            status: "rejected",
            code: "INVALID_MOVE_PAYLOAD",
            message: "Invalid move payload.",
            clock: getClockSnapshot(matchState, nowMs),
        };
    }

    const fromPiece = matchState.chess.get(normalizedMove.from);
    if (!fromPiece || fromPiece.color !== playerColor) {
        return {
            status: "rejected",
            code: "INVALID_SOURCE",
            message: "Selected source square is invalid.",
            clock: getClockSnapshot(matchState, nowMs),
        };
    }

    let promotion = normalizePromotion(promoType);
    if (
        fromPiece.type === "p" &&
        (normalizedMove.to.endsWith("1") || normalizedMove.to.endsWith("8")) &&
        !promotion
    ) {
        promotion = "q";
    }

    let moveResult = null;
    try {
        moveResult = matchState.chess.move({
            from: normalizedMove.from,
            to: normalizedMove.to,
            promotion: promotion || undefined,
        });
    } catch {
        moveResult = null;
    }

    if (!moveResult) {
        return {
            status: "rejected",
            code: "ILLEGAL_MOVE",
            message: "Illegal move.",
            clock: getClockSnapshot(matchState, nowMs),
        };
    }

    const clock = matchState.clock;
    if (clock.enabled) {
        const now = normalizeNow(nowMs, clock.lastTickAt);
        clock.remainingMs[playerColor] += clock.incrementMs;
        clock.activeColor = matchState.chess.turn();
        clock.lastTickAt = now;
    }

    matchState.moveCount += 1;
    matchState.drawOfferedBy = null;

    const clientMove = buildClientMove(moveResult);
    if (!clientMove) {
        return {
            status: "rejected",
            code: "MOVE_SERIALIZATION_FAILED",
            message: "Failed to serialize move.",
            clock: getClockSnapshot(matchState, nowMs),
        };
    }

    return {
        status: "applied",
        playerColor,
        move: clientMove,
        promoType: clientMove.promoPiece,
        clock: getClockSnapshot(matchState, nowMs),
        outcome: detectOutcome(matchState.chess, playerColor),
    };
}

function offerDraw(matchState, socketId) {
    if (!socketId) {
        return {
            ok: false,
            code: "INVALID_SOCKET",
        };
    }
    if (matchState.drawOfferedBy) {
        return {
            ok: false,
            code: "DRAW_ALREADY_OFFERED",
        };
    }
    matchState.drawOfferedBy = socketId;
    return { ok: true };
}

function declineDraw(matchState, socketId) {
    const offeredBy = matchState.drawOfferedBy;
    if (!offeredBy || offeredBy === socketId) {
        return {
            ok: false,
            code: "NO_PENDING_DRAW",
        };
    }
    matchState.drawOfferedBy = null;
    return {
        ok: true,
        offeredBy,
    };
}

function acceptDraw(matchState, socketId) {
    const offeredBy = matchState.drawOfferedBy;
    if (!offeredBy || offeredBy === socketId) {
        return {
            ok: false,
            code: "NO_PENDING_DRAW",
        };
    }
    matchState.drawOfferedBy = null;
    return {
        ok: true,
        winnerColor: null,
        reason: "draw",
        result: "draw",
    };
}

module.exports = {
    createMatchState,
    applyMove,
    checkTimeout,
    getClockSnapshot,
    getTimeoutDelayMs,
    offerDraw,
    declineDraw,
    acceptDraw,
    colorToResult,
    oppositeColor,
};
