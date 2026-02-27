/**
 * ================================================
 * CHESS GAME - Full browser chess implementation
 * Features: All piece moves, Castling, En Passant,
 *           Promotion, Check, Checkmate, Stalemate,
 *           Undo, Move History (algebraic notation),
 *           AI Opponent (Minimax + Alpha-Beta Pruning),
 *           Game Menu with difficulty selection
 * ================================================
 */

"use strict";

// ================================================
// CONSTANTS
// ================================================
const COLOR = { W: "w", B: "b" };

const PIECE = { K: "K", Q: "Q", R: "R", B: "B", N: "N", P: "P" };

// Unicode symbols [white, black]
const SYMBOLS = {
    K: ["♔", "♚"],
    Q: ["♕", "♛"],
    R: ["♖", "♜"],
    B: ["♗", "♝"],
    N: ["♘", "♞"],
    P: ["♙", "♟"],
};

const CAPTURE_SYMBOLS = {
    K: "♚",
    Q: "♛",
    R: "♜",
    B: "♝",
    N: "♞",
    P: "♟",
};

// Initial board layout (rank 8 → rank 1 top→bottom)
const INIT_BOARD = [
    ["bR", "bN", "bB", "bQ", "bK", "bB", "bN", "bR"],
    ["bP", "bP", "bP", "bP", "bP", "bP", "bP", "bP"],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    ["wP", "wP", "wP", "wP", "wP", "wP", "wP", "wP"],
    ["wR", "wN", "wB", "wQ", "wK", "wB", "wN", "wR"],
];

const FILE_NAMES = ["a", "b", "c", "d", "e", "f", "g", "h"];

// ================================================
// GAME MODE
// ================================================
let gameMode = null; // "pvp", "ai", or "online"
let aiDifficulty = null; // "easy", "medium", "hard", "superhard"
let aiThinking = false;

const DIFFICULTY_DEPTH = {
    easy: 0, // random
    medium: 2,
    hard: 3,
    superhard: 4,
};

const DIFFICULTY_LABELS = {
    easy: "🟢 Dễ",
    medium: "🟡 Trung bình",
    hard: "🔴 Khó",
    superhard: "💀 Siêu khó",
};

// ================================================
// GAME STATE
// ================================================
let state = {};

function initState() {
    state = {
        board: INIT_BOARD.map((r) => [...r]),
        turn: COLOR.W,
        castling: { wK: true, wQ: true, bK: true, bQ: true },
        enPassant: null, // target square { r, c } or null
        halfMove: 0,
        fullMove: 1,
        history: [], // array of snapshot objects for undo
        moves: [], // algebraic notation strings
        captured: { w: [], b: [] }, // pieces captured from each color
        gameOver: false,
        inCheck: false,
    };
}

// ================================================
// BOARD HELPERS
// ================================================
function inBounds(r, c) {
    return r >= 0 && r < 8 && c >= 0 && c < 8;
}

function pieceAt(board, r, c) {
    return board[r][c];
}
function colorOf(p) {
    return p ? p[0] : null;
}
function typeOf(p) {
    return p ? p[1] : null;
}
function enemy(color) {
    return color === COLOR.W ? COLOR.B : COLOR.W;
}

function cloneBoard(board) {
    return board.map((r) => [...r]);
}

function squareName(r, c) {
    return FILE_NAMES[c] + (8 - r);
}

function findKing(board, color) {
    for (let r = 0; r < 8; r++)
        for (let c = 0; c < 8; c++)
            if (board[r][c] === color + "K") return { r, c };
    return null;
}

// ================================================
// ATTACK CHECK
// ================================================
function isAttackedBy(board, r, c, attacker) {
    // Pawn attacks
    const dir = attacker === COLOR.W ? 1 : -1;
    for (const dc of [-1, 1]) {
        const pr = r + dir,
            pc = c + dc;
        if (inBounds(pr, pc) && board[pr][pc] === attacker + "P") return true;
    }
    // Knight
    for (const [dr, dc] of [
        [-2, -1],
        [-2, 1],
        [-1, -2],
        [-1, 2],
        [1, -2],
        [1, 2],
        [2, -1],
        [2, 1],
    ]) {
        const nr = r + dr,
            nc = c + dc;
        if (inBounds(nr, nc) && board[nr][nc] === attacker + "N") return true;
    }
    // King
    for (const [dr, dc] of [
        [-1, -1],
        [-1, 0],
        [-1, 1],
        [0, -1],
        [0, 1],
        [1, -1],
        [1, 0],
        [1, 1],
    ]) {
        const nr = r + dr,
            nc = c + dc;
        if (inBounds(nr, nc) && board[nr][nc] === attacker + "K") return true;
    }
    // Rook / Queen (straight lines)
    for (const [dr, dc] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
    ]) {
        let nr = r + dr,
            nc = c + dc;
        while (inBounds(nr, nc)) {
            const p = board[nr][nc];
            if (p) {
                if (p === attacker + "R" || p === attacker + "Q") return true;
                break;
            }
            nr += dr;
            nc += dc;
        }
    }
    // Bishop / Queen (diagonals)
    for (const [dr, dc] of [
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1],
    ]) {
        let nr = r + dr,
            nc = c + dc;
        while (inBounds(nr, nc)) {
            const p = board[nr][nc];
            if (p) {
                if (p === attacker + "B" || p === attacker + "Q") return true;
                break;
            }
            nr += dr;
            nc += dc;
        }
    }
    return false;
}

function isInCheck(board, color) {
    const king = findKing(board, color);
    if (!king) return false;
    return isAttackedBy(board, king.r, king.c, enemy(color));
}

// ================================================
// MOVE GENERATION
// ================================================
function pseudoMoves(board, r, c, enPassant) {
    const piece = board[r][c];
    if (!piece) return [];
    const color = colorOf(piece);
    const type = typeOf(piece);
    const moves = [];

    const addIf = (tr, tc) => {
        if (!inBounds(tr, tc)) return false;
        const t = board[tr][tc];
        if (t && colorOf(t) === color) return false;
        moves.push({ fr: r, fc: c, tr, tc });
        return !t;
    };

    switch (type) {
        case "P": {
            const dir = color === COLOR.W ? -1 : 1;
            const startRank = color === COLOR.W ? 6 : 1;
            const promRank = color === COLOR.W ? 0 : 7;
            // Forward
            const nr = r + dir;
            if (inBounds(nr, c) && !board[nr][c]) {
                moves.push({
                    fr: r,
                    fc: c,
                    tr: nr,
                    tc: c,
                    promo: nr === promRank,
                });
                // Double push
                if (r === startRank && !board[r + 2 * dir][c]) {
                    moves.push({ fr: r, fc: c, tr: r + 2 * dir, tc: c });
                }
            }
            // Captures
            for (const dc of [-1, 1]) {
                const nc = c + dc;
                if (!inBounds(nr, nc)) continue;
                if (board[nr][nc] && colorOf(board[nr][nc]) !== color) {
                    moves.push({
                        fr: r,
                        fc: c,
                        tr: nr,
                        tc: nc,
                        promo: nr === promRank,
                    });
                }
                // En passant
                if (enPassant && enPassant.r === nr && enPassant.c === nc) {
                    moves.push({
                        fr: r,
                        fc: c,
                        tr: nr,
                        tc: nc,
                        enPassant: true,
                    });
                }
            }
            break;
        }
        case "N":
            for (const [dr, dc] of [
                [-2, -1],
                [-2, 1],
                [-1, -2],
                [-1, 2],
                [1, -2],
                [1, 2],
                [2, -1],
                [2, 1],
            ])
                addIf(r + dr, c + dc);
            break;
        case "B":
            for (const [dr, dc] of [
                [-1, -1],
                [-1, 1],
                [1, -1],
                [1, 1],
            ]) {
                let nr = r + dr,
                    nc = c + dc;
                while (addIf(nr, nc)) {
                    nr += dr;
                    nc += dc;
                }
            }
            break;
        case "R":
            for (const [dr, dc] of [
                [-1, 0],
                [1, 0],
                [0, -1],
                [0, 1],
            ]) {
                let nr = r + dr,
                    nc = c + dc;
                while (addIf(nr, nc)) {
                    nr += dr;
                    nc += dc;
                }
            }
            break;
        case "Q":
            for (const [dr, dc] of [
                [-1, -1],
                [-1, 1],
                [1, -1],
                [1, 1],
                [-1, 0],
                [1, 0],
                [0, -1],
                [0, 1],
            ]) {
                let nr = r + dr,
                    nc = c + dc;
                while (addIf(nr, nc)) {
                    nr += dr;
                    nc += dc;
                }
            }
            break;
        case "K":
            for (const [dr, dc] of [
                [-1, -1],
                [-1, 0],
                [-1, 1],
                [0, -1],
                [0, 1],
                [1, -1],
                [1, 0],
                [1, 1],
            ])
                addIf(r + dr, c + dc);
            break;
    }
    return moves;
}

function castlingMoves(board, color, castling) {
    const moves = [];
    const row = color === COLOR.W ? 7 : 0;
    if (isInCheck(board, color)) return moves;

    // Kingside
    const ksKey = color + "K";
    if (castling[ksKey]) {
        if (!board[row][5] && !board[row][6]) {
            if (
                !isAttackedBy(board, row, 5, enemy(color)) &&
                !isAttackedBy(board, row, 6, enemy(color))
            ) {
                moves.push({ fr: row, fc: 4, tr: row, tc: 6, castling: "K" });
            }
        }
    }
    // Queenside
    const qsKey = color + "Q";
    if (castling[qsKey]) {
        if (!board[row][3] && !board[row][2] && !board[row][1]) {
            if (
                !isAttackedBy(board, row, 3, enemy(color)) &&
                !isAttackedBy(board, row, 2, enemy(color))
            ) {
                moves.push({ fr: row, fc: 4, tr: row, tc: 2, castling: "Q" });
            }
        }
    }
    return moves;
}

function legalMoves(board, r, c, color, castling, enPassant) {
    const piece = board[r][c];
    if (!piece || colorOf(piece) !== color) return [];

    const candidates = pseudoMoves(board, r, c, enPassant);
    if (typeOf(piece) === "K")
        candidates.push(...castlingMoves(board, color, castling));

    return candidates.filter((m) => {
        const nb = applyMoveToBoard(cloneBoard(board), m);
        return !isInCheck(nb, color);
    });
}

function allLegalMoves(color) {
    const moves = [];
    for (let r = 0; r < 8; r++)
        for (let c = 0; c < 8; c++)
            if (colorOf(state.board[r][c]) === color)
                moves.push(
                    ...legalMoves(
                        state.board,
                        r,
                        c,
                        color,
                        state.castling,
                        state.enPassant,
                    ),
                );
    return moves;
}

// Helper: generate all legal moves from a given board state (for AI)
function allLegalMovesFrom(board, color, castling, enPassant) {
    const moves = [];
    for (let r = 0; r < 8; r++)
        for (let c = 0; c < 8; c++)
            if (colorOf(board[r][c]) === color)
                moves.push(
                    ...legalMoves(board, r, c, color, castling, enPassant),
                );
    return moves;
}

// ================================================
// APPLY MOVE TO BOARD (returns new board)
// ================================================
function applyMoveToBoard(board, move) {
    const { fr, fc, tr, tc } = move;
    const piece = board[fr][fc];

    board[tr][tc] = piece;
    board[fr][fc] = null;

    // En passant capture
    if (move.enPassant) {
        const capRow = colorOf(piece) === COLOR.W ? tr + 1 : tr - 1;
        board[capRow][tc] = null;
    }

    // Castling: move the rook
    if (move.castling) {
        const row = fr;
        if (move.castling === "K") {
            board[row][5] = board[row][7];
            board[row][7] = null;
        } else {
            board[row][3] = board[row][0];
            board[row][0] = null;
        }
    }

    // Promotion
    if (move.promoPiece) {
        board[tr][tc] = colorOf(piece) + move.promoPiece;
    }

    return board;
}

// ================================================
// ALGEBRAIC NOTATION HELPER
// ================================================
function buildNotation(board, move, promoType) {
    const piece = board[move.fr][move.fc];
    const type = typeOf(piece);
    const color = colorOf(piece);
    const captured =
        board[move.tr][move.tc] || (move.enPassant ? enemy(color) + "P" : null);
    let note = "";

    if (move.castling === "K") return "O-O";
    if (move.castling === "Q") return "O-O-O";

    if (type !== "P") note += type;
    if (captured) note += "x";
    note += squareName(move.tr, move.tc);
    if (move.promo || move.promoPiece) note += "=" + (promoType || "Q");
    return note;
}

// ================================================
// EXECUTE MOVE
// ================================================
function executeMove(move, promoType) {
    // Save snapshot for undo
    state.history.push({
        board: cloneBoard(state.board),
        turn: state.turn,
        castling: { ...state.castling },
        enPassant: state.enPassant,
        captured: { w: [...state.captured.w], b: [...state.captured.b] },
        moves: [...state.moves],
    });

    const piece = state.board[move.fr][move.fc];
    const color = colorOf(piece);
    const type = typeOf(piece);

    // Notation before applying
    const notation = buildNotation(state.board, move, promoType);

    // Track captures
    let capturedPiece = state.board[move.tr][move.tc];
    if (move.enPassant) {
        const capRow = color === COLOR.W ? move.tr + 1 : move.tr - 1;
        capturedPiece = state.board[capRow][move.tc];
    }
    if (capturedPiece) {
        const capColor = colorOf(capturedPiece);
        state.captured[capColor].push(capturedPiece);
    }

    // Apply promotion piece if provided
    if (promoType) move.promoPiece = promoType;

    // Apply move
    state.board = applyMoveToBoard(state.board, move);

    // Update castling rights
    if (type === "K") {
        state.castling[color + "K"] = false;
        state.castling[color + "Q"] = false;
    }
    if (type === "R") {
        if (move.fc === 0) state.castling[color + "Q"] = false;
        if (move.fc === 7) state.castling[color + "K"] = false;
    }
    // If rook captured
    if (capturedPiece && typeOf(capturedPiece) === "R") {
        const ec = enemy(color);
        if (move.tr === (ec === COLOR.W ? 7 : 0)) {
            if (move.tc === 0) state.castling[ec + "Q"] = false;
            if (move.tc === 7) state.castling[ec + "K"] = false;
        }
    }

    // En passant target
    state.enPassant = null;
    if (type === "P" && Math.abs(move.tr - move.fr) === 2) {
        state.enPassant = { r: (move.fr + move.tr) / 2, c: move.fc };
    }

    // Switch turn
    state.turn = enemy(color);

    // Check / Checkmate / Stalemate
    const nextMoves = allLegalMoves(state.turn);
    state.inCheck = isInCheck(state.board, state.turn);

    let finalNote = notation;
    if (nextMoves.length === 0) {
        if (state.inCheck) {
            finalNote += "#";
            state.gameOver = true;
            state.winner = color;
        } else {
            finalNote += " (Stalemate)";
            state.gameOver = true;
            state.winner = null;
        }
    } else if (state.inCheck) {
        finalNote += "+";
    }

    state.moves.push({ color, note: finalNote });

    // ── Play sound effect ──
    if (state.gameOver && state.winner) {
        ChessSounds.checkmate();
    } else if (state.gameOver && !state.winner) {
        ChessSounds.stalemate();
    } else if (state.inCheck) {
        ChessSounds.check();
    } else if (promoType) {
        ChessSounds.promote();
    } else if (move.castling) {
        ChessSounds.castling();
    } else if (capturedPiece) {
        ChessSounds.capture();
    } else {
        ChessSounds.move();
    }

    render();
    if (state.gameOver) {
        showGameOver();
        // Notify server only if we are the one who detected game over
        // (the move we just executed was OUR move)
        if (
            gameMode === "online" &&
            typeof notifyGameOverOnline === "function"
        ) {
            const movingColor = enemy(state.turn); // turn already switched
            if (movingColor === myOnlineColor) {
                notifyGameOverOnline(
                    state.winner,
                    state.winner ? "checkmate" : "stalemate",
                );
            }
        }
    }
}

// ================================================
// UI STATE
// ================================================
let selectedSq = null; // { r, c }
let legalMoveSqs = []; // array of move objects
let lastMove = null; // { fr, fc, tr, tc }
let pendingPromo = null; // move object awaiting promotion choice
let boardFlipped = false; // true when playing as black in online mode

// ================================================
// RENDER
// ================================================
const boardEl = document.getElementById("board");

function render() {
    renderBoard();
    renderTurn();
    renderStatus();
    renderCaptured();
    renderMoveHistory();
    updateCoordSizes();
    renderModeBadge();
}

function renderBoard() {
    boardEl.innerHTML = "";
    // When boardFlipped, render from row 7→0 and col 7→0 so black is at bottom
    const rowOrder = boardFlipped
        ? [7, 6, 5, 4, 3, 2, 1, 0]
        : [0, 1, 2, 3, 4, 5, 6, 7];
    const colOrder = boardFlipped
        ? [7, 6, 5, 4, 3, 2, 1, 0]
        : [0, 1, 2, 3, 4, 5, 6, 7];

    const firstCol = colOrder[0]; // leftmost column displayed
    const lastRow = rowOrder[7]; // bottom row displayed

    for (const r of rowOrder) {
        for (const c of colOrder) {
            const sq = document.createElement("div");
            sq.className = "sq " + ((r + c) % 2 === 0 ? "light" : "dark");
            sq.dataset.r = r;
            sq.dataset.c = c;
            sq.id = `sq-${r}-${c}`;

            // Highlights
            if (lastMove) {
                if (
                    (r === lastMove.fr && c === lastMove.fc) ||
                    (r === lastMove.tr && c === lastMove.tc)
                )
                    sq.classList.add("last-to");
            }
            if (selectedSq && selectedSq.r === r && selectedSq.c === c)
                sq.classList.add("selected");

            // Check highlight on king
            if (state.inCheck) {
                const king = findKing(state.board, state.turn);
                if (king && king.r === r && king.c === c)
                    sq.classList.add("in-check");
            }

            // Legal move hints
            const hint = legalMoveSqs.find((m) => m.tr === r && m.tc === c);
            if (hint) {
                sq.classList.add("hint");
                if (state.board[r][c]) sq.classList.add("has-piece");
            }

            // ── Inline coordinate labels (chess.com style) ──
            // Rank number: shown on leftmost column of each row
            if (c === firstCol) {
                const rankLabel = document.createElement("span");
                rankLabel.className = "sq-rank-label";
                rankLabel.textContent = 8 - r; // row 0 = rank 8, row 7 = rank 1
                sq.appendChild(rankLabel);
            }
            // File letter: shown on bottom row of each column
            if (r === lastRow) {
                const fileLabel = document.createElement("span");
                fileLabel.className = "sq-file-label";
                fileLabel.textContent = FILE_NAMES[c];
                sq.appendChild(fileLabel);
            }

            // Piece
            const piece = state.board[r][c];
            if (piece) {
                const span = document.createElement("span");
                const pColor = colorOf(piece) === COLOR.W ? 0 : 1;
                span.className =
                    "piece " +
                    (colorOf(piece) === COLOR.W
                        ? "piece--white"
                        : "piece--black");
                span.textContent = SYMBOLS[typeOf(piece)][pColor];
                sq.appendChild(span);
            }

            sq.addEventListener("click", onSquareClick);
            boardEl.appendChild(sq);
        }
    }
}

function renderTurn() {
    const ind = document.getElementById("turn-indicator");
    const pl = document.getElementById("turn-player");
    if (!ind || !pl) return;
    ind.className =
        "turn-indicator " + (state.turn === COLOR.W ? "white" : "black");
    pl.textContent = state.turn === COLOR.W ? "Trắng" : "Đen";
}

function renderStatus() {
    const banner = document.getElementById("status-banner");
    if (!banner) return;

    if (aiThinking) {
        banner.innerHTML = `<div class="ai-thinking">🤖 AI đang suy nghĩ<div class="dots"><span></span><span></span><span></span></div></div>`;
        return;
    }

    if (state.inCheck && !state.gameOver) {
        const who = state.turn === COLOR.W ? "Trắng" : "Đen";
        banner.textContent = `⚠️ ${who} đang bị chiếu!`;
    } else {
        banner.textContent = "";
    }
}

function renderCaptured() {
    const wpEl = document.getElementById("captured-white-pieces");
    const bpEl = document.getElementById("captured-black-pieces");
    if (wpEl)
        wpEl.innerHTML = state.captured.w
            .map(
                (p) =>
                    `<span title="${typeOf(p)}">${CAPTURE_SYMBOLS[typeOf(p)]}</span>`,
            )
            .join("");
    if (bpEl)
        bpEl.innerHTML = state.captured.b
            .map(
                (p) =>
                    `<span title="${typeOf(p)}">${CAPTURE_SYMBOLS[typeOf(p)]}</span>`,
            )
            .join("");
}

function renderMoveHistory() {
    const tbody = document.getElementById("move-list-body");
    const countEl = document.getElementById("move-count");
    if (!tbody) return;
    tbody.innerHTML = "";
    const pairs = [];
    let i = 0;
    while (i < state.moves.length) {
        const w = state.moves[i];
        const b = state.moves[i + 1];
        pairs.push([w, b]);
        i += 2;
    }
    pairs.forEach((p, idx) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${idx + 1}.</td><td>${p[0]?.note || ""}</td><td>${p[1]?.note || ""}</td>`;
        tbody.appendChild(tr);
    });
    // Scroll to bottom
    const wrap = document.querySelector(".move-list-wrap");
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
    if (countEl) countEl.textContent = `${state.moves.length} nước đi`;
}

function renderModeBadge() {
    const badge = document.getElementById("mode-badge");
    if (!badge) return;
    if (!gameMode) {
        badge.textContent = "";
        return;
    }
    if (gameMode === "pvp") {
        badge.textContent = "👥 2 Người";
    } else if (gameMode === "online") {
        const colorLabel =
            typeof myOnlineColor !== "undefined" && myOnlineColor
                ? myOnlineColor === "w"
                    ? "♔ Trắng"
                    : "♚ Đen"
                : "";
        const opp =
            typeof opponentName !== "undefined" && opponentName
                ? ` vs ${opponentName}`
                : "";
        badge.textContent = `🌐 Online — ${colorLabel}${opp}`;
    } else {
        badge.textContent = `🤖 vs AI — ${DIFFICULTY_LABELS[aiDifficulty] || ""}`;
    }
}

function updateCoordSizes() {
    const sqSize = boardEl.offsetWidth / 8;
    const colEl = document.getElementById("col-labels");
    const rowEl = document.getElementById("row-labels");
    if (colEl) {
        const colLabels = boardFlipped
            ? ["h", "g", "f", "e", "d", "c", "b", "a"]
            : ["a", "b", "c", "d", "e", "f", "g", "h"];
        [...colEl.children].forEach((s, i) => {
            s.style.width = sqSize + "px";
            s.style.height = "20px";
            s.textContent = colLabels[i];
        });
    }
    if (rowEl) {
        const rowLabels = boardFlipped
            ? ["1", "2", "3", "4", "5", "6", "7", "8"]
            : ["8", "7", "6", "5", "4", "3", "2", "1"];
        [...rowEl.children].forEach((s, i) => {
            s.style.width = "20px";
            s.style.height = sqSize + "px";
            s.textContent = rowLabels[i];
        });
    }
}

// ================================================
// CLICK HANDLER
// ================================================
function onSquareClick(e) {
    if (state.gameOver) return;
    // Block clicks during AI turn
    if (gameMode === "ai" && state.turn === COLOR.B) return;
    if (aiThinking) return;
    // Block clicks when it's not your color in online mode
    if (
        gameMode === "online" &&
        state.turn !==
            (typeof myOnlineColor !== "undefined" ? myOnlineColor : state.turn)
    )
        return;

    const sq = e.currentTarget;
    const r = parseInt(sq.dataset.r);
    const c = parseInt(sq.dataset.c);

    // If a hint square is clicked → execute move
    if (selectedSq) {
        const move = legalMoveSqs.find((m) => m.tr === r && m.tc === c);
        if (move) {
            // Promotion?
            if (move.promo) {
                pendingPromo = move;
                showPromoModal(colorOf(state.board[move.fr][move.fc]));
                return;
            }
            lastMove = move;
            selectedSq = null;
            legalMoveSqs = [];
            executeMove(move, null);
            // Trigger AI after human move
            if (gameMode === "ai" && !state.gameOver) {
                scheduleAiMove();
            }
            // Send move to server in online mode
            if (gameMode === "online") {
                sendMoveOnline(move, null);
            }
            return;
        }
    }

    // Select a piece
    const piece = state.board[r][c];
    if (piece && colorOf(piece) === state.turn) {
        if (selectedSq && selectedSq.r === r && selectedSq.c === c) {
            // Deselect
            selectedSq = null;
            legalMoveSqs = [];
        } else {
            selectedSq = { r, c };
            legalMoveSqs = legalMoves(
                state.board,
                r,
                c,
                state.turn,
                state.castling,
                state.enPassant,
            );
            ChessSounds.select();
        }
        renderBoard();
        return;
    }

    // Clicked empty / enemy but not a hint → deselect
    selectedSq = null;
    legalMoveSqs = [];
    renderBoard();
}

// ================================================
// PROMOTION MODAL
// ================================================
function showPromoModal(color) {
    const modal = document.getElementById("promotion-modal");
    const choices = document.getElementById("promotion-choices");
    choices.innerHTML = "";
    const promoTypes = ["Q", "R", "B", "N"];
    promoTypes.forEach((t) => {
        const btn = document.createElement("button");
        btn.className = "promo-btn";
        btn.textContent = SYMBOLS[t][color === COLOR.W ? 0 : 1];
        btn.title = { Q: "Hậu", R: "Xe", B: "Tượng", N: "Mã" }[t];
        btn.addEventListener("click", () => {
            modal.hidden = true;
            lastMove = pendingPromo;
            const move = pendingPromo;
            pendingPromo = null;
            selectedSq = null;
            legalMoveSqs = [];
            executeMove(move, t);
            // Trigger AI after human promotion
            if (gameMode === "ai" && !state.gameOver) {
                scheduleAiMove();
            }
            // Send promotion move online
            if (gameMode === "online") {
                sendMoveOnline(move, t);
            }
        });
        choices.appendChild(btn);
    });
    modal.hidden = false;
}

// ================================================
// GAME OVER MODAL
// ================================================
function showGameOver() {
    const modal = document.getElementById("gameover-modal");
    const titleEl = document.getElementById("gameover-title");
    const msgEl = document.getElementById("gameover-msg");
    const iconEl = document.getElementById("gameover-icon");

    if (state.winner) {
        const who = state.winner === COLOR.W ? "Trắng" : "Đen";
        iconEl.textContent = state.winner === COLOR.W ? "♔" : "♚";
        titleEl.textContent = `${who} thắng!`;
        msgEl.textContent = "Chiếu hết – Ván cờ kết thúc. Chúc mừng!";
    } else {
        iconEl.textContent = "🤝";
        titleEl.textContent = "Hòa cờ!";
        msgEl.textContent = "Stalemate – không còn nước đi hợp lệ.";
    }
    modal.hidden = false;
}

// ================================================
// NEW GAME / UNDO
// ================================================
function newGame() {
    boardFlipped = false; // reset board orientation
    initState();
    selectedSq = null;
    legalMoveSqs = [];
    lastMove = null;
    pendingPromo = null;
    aiThinking = false;
    document.getElementById("gameover-modal").hidden = true;
    document.getElementById("promotion-modal").hidden = true;
    render();
    showGameMenu();
}

function undoMove() {
    if (state.history.length === 0) return;
    if (aiThinking) return;
    // Undo not allowed in online mode
    if (gameMode === "online") {
        if (typeof showOnlineNotification === "function")
            showOnlineNotification(
                "Không thể hoàn tác trong chế độ online.",
                "info",
            );
        return;
    }

    if (gameMode === "ai") {
        // Undo both AI move and human move
        if (state.history.length >= 2) {
            state.history.pop(); // AI move
            const snap = state.history.pop(); // Human move
            state.board = snap.board;
            state.turn = snap.turn;
            state.castling = snap.castling;
            state.enPassant = snap.enPassant;
            state.captured = snap.captured;
            state.moves = snap.moves;
        } else {
            const snap = state.history.pop();
            state.board = snap.board;
            state.turn = snap.turn;
            state.castling = snap.castling;
            state.enPassant = snap.enPassant;
            state.captured = snap.captured;
            state.moves = snap.moves;
        }
    } else {
        const snap = state.history.pop();
        state.board = snap.board;
        state.turn = snap.turn;
        state.castling = snap.castling;
        state.enPassant = snap.enPassant;
        state.captured = snap.captured;
        state.moves = snap.moves;
    }

    state.gameOver = false;
    state.inCheck = isInCheck(state.board, state.turn);
    state.winner = null;
    selectedSq = null;
    legalMoveSqs = [];
    lastMove = null;
    document.getElementById("gameover-modal").hidden = true;
    render();
}

// ================================================
// GAME MENU
// ================================================
function showGameMenu() {
    const menu = document.getElementById("game-menu");
    const stepMode = document.getElementById("menu-step-mode");
    const stepDiff = document.getElementById("menu-step-diff");
    const stepOnline = document.getElementById("menu-step-online");
    stepMode.hidden = false;
    stepDiff.hidden = true;
    if (stepOnline) stepOnline.hidden = true;
    menu.hidden = false;
}

function hideGameMenu() {
    document.getElementById("game-menu").hidden = true;
}

function startGame(mode, difficulty) {
    gameMode = mode;
    aiDifficulty = difficulty;
    hideGameMenu();
    initState();
    selectedSq = null;
    legalMoveSqs = [];
    lastMove = null;
    pendingPromo = null;
    aiThinking = false;
    document.getElementById("gameover-modal").hidden = true;
    document.getElementById("promotion-modal").hidden = true;
    render();
    ChessSounds.gameStart();
}

/**
 * Start an online game. Called by online.js when server signals game_start.
 * @param {string} myColor - "w" or "b"
 * @param {string} opponentNameStr - opponent display name
 */
function startOnlineGame(myColor, opponentNameStr) {
    gameMode = "online";
    aiDifficulty = null;
    // Flip board so the current player always sees themselves at the bottom
    boardFlipped = myColor === "b";
    hideGameMenu();
    initState();
    selectedSq = null;
    legalMoveSqs = [];
    lastMove = null;
    pendingPromo = null;
    aiThinking = false;
    document.getElementById("gameover-modal").hidden = true;
    document.getElementById("promotion-modal").hidden = true;
    render();
    ChessSounds.gameStart();

    // Show which color you are playing
    const colorName = myColor === "w" ? "Trắng" : "Đen";
    if (typeof showOnlineNotification === "function") {
        showOnlineNotification(
            `🌐 Bạn chơi quân ${colorName} vs ${opponentNameStr || "Đối thủ"}`,
            "info",
        );
    }
}

// Menu event listeners
document.getElementById("menu-pvp").addEventListener("click", () => {
    startGame("pvp", null);
});

document.getElementById("menu-ai").addEventListener("click", () => {
    document.getElementById("menu-step-mode").hidden = true;
    document.getElementById("menu-step-diff").hidden = false;
});

document.getElementById("menu-back").addEventListener("click", () => {
    document.getElementById("menu-step-mode").hidden = false;
    document.getElementById("menu-step-diff").hidden = true;
});

// Online mode
document.getElementById("menu-online").addEventListener("click", () => {
    document.getElementById("menu-step-mode").hidden = true;
    document.getElementById("menu-step-online").hidden = false;
});

document.getElementById("menu-back-online").addEventListener("click", () => {
    document.getElementById("menu-step-mode").hidden = false;
    document.getElementById("menu-step-online").hidden = true;
});

document.getElementById("btn-start-online").addEventListener("click", () => {
    const nameInput = document.getElementById("online-player-name");
    const name = (nameInput?.value || "").trim() || "Ẩn danh";
    joinOnlineQueue(name);
});

document.getElementById("btn-cancel-queue").addEventListener("click", () => {
    cancelQueue();
    showGameMenu();
});

document.querySelectorAll(".diff-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
        const diff = btn.dataset.diff;
        startGame("ai", diff);
    });
});

// ================================================
// AI ENGINE
// ================================================

// Piece values
const PIECE_VALUES = {
    P: 100,
    N: 320,
    B: 330,
    R: 500,
    Q: 900,
    K: 20000,
};

// Piece-square tables (from white's perspective, flip for black)
const PST = {
    P: [
        [0, 0, 0, 0, 0, 0, 0, 0],
        [50, 50, 50, 50, 50, 50, 50, 50],
        [10, 10, 20, 30, 30, 20, 10, 10],
        [5, 5, 10, 25, 25, 10, 5, 5],
        [0, 0, 0, 20, 20, 0, 0, 0],
        [5, -5, -10, 0, 0, -10, -5, 5],
        [5, 10, 10, -20, -20, 10, 10, 5],
        [0, 0, 0, 0, 0, 0, 0, 0],
    ],
    N: [
        [-50, -40, -30, -30, -30, -30, -40, -50],
        [-40, -20, 0, 0, 0, 0, -20, -40],
        [-30, 0, 10, 15, 15, 10, 0, -30],
        [-30, 5, 15, 20, 20, 15, 5, -30],
        [-30, 0, 15, 20, 20, 15, 0, -30],
        [-30, 5, 10, 15, 15, 10, 5, -30],
        [-40, -20, 0, 5, 5, 0, -20, -40],
        [-50, -40, -30, -30, -30, -30, -40, -50],
    ],
    B: [
        [-20, -10, -10, -10, -10, -10, -10, -20],
        [-10, 0, 0, 0, 0, 0, 0, -10],
        [-10, 0, 5, 10, 10, 5, 0, -10],
        [-10, 5, 5, 10, 10, 5, 5, -10],
        [-10, 0, 10, 10, 10, 10, 0, -10],
        [-10, 10, 10, 10, 10, 10, 10, -10],
        [-10, 5, 0, 0, 0, 0, 5, -10],
        [-20, -10, -10, -10, -10, -10, -10, -20],
    ],
    R: [
        [0, 0, 0, 0, 0, 0, 0, 0],
        [5, 10, 10, 10, 10, 10, 10, 5],
        [-5, 0, 0, 0, 0, 0, 0, -5],
        [-5, 0, 0, 0, 0, 0, 0, -5],
        [-5, 0, 0, 0, 0, 0, 0, -5],
        [-5, 0, 0, 0, 0, 0, 0, -5],
        [-5, 0, 0, 0, 0, 0, 0, -5],
        [0, 0, 0, 5, 5, 0, 0, 0],
    ],
    Q: [
        [-20, -10, -10, -5, -5, -10, -10, -20],
        [-10, 0, 0, 0, 0, 0, 0, -10],
        [-10, 0, 5, 5, 5, 5, 0, -10],
        [-5, 0, 5, 5, 5, 5, 0, -5],
        [0, 0, 5, 5, 5, 5, 0, -5],
        [-10, 5, 5, 5, 5, 5, 0, -10],
        [-10, 0, 5, 0, 0, 0, 0, -10],
        [-20, -10, -10, -5, -5, -10, -10, -20],
    ],
    K: [
        [-30, -40, -40, -50, -50, -40, -40, -30],
        [-30, -40, -40, -50, -50, -40, -40, -30],
        [-30, -40, -40, -50, -50, -40, -40, -30],
        [-30, -40, -40, -50, -50, -40, -40, -30],
        [-20, -30, -30, -40, -40, -30, -30, -20],
        [-10, -20, -20, -20, -20, -20, -20, -10],
        [20, 20, 0, 0, 0, 0, 20, 20],
        [20, 30, 10, 0, 0, 10, 30, 20],
    ],
};

function evaluateBoard(board) {
    let score = 0;
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const p = board[r][c];
            if (!p) continue;
            const color = colorOf(p);
            const type = typeOf(p);
            const val = PIECE_VALUES[type];
            // PST: white uses table as-is, black mirrors rows
            const pstRow = color === COLOR.W ? r : 7 - r;
            const pstVal = PST[type][pstRow][c];

            if (color === COLOR.W) {
                score += val + pstVal;
            } else {
                score -= val + pstVal;
            }
        }
    }
    return score;
}

// Update castling after a move (for AI simulation)
function updateCastlingRights(castling, board, move, piece, capturedPiece) {
    const newCastling = { ...castling };
    const color = colorOf(piece);
    const type = typeOf(piece);

    if (type === "K") {
        newCastling[color + "K"] = false;
        newCastling[color + "Q"] = false;
    }
    if (type === "R") {
        if (move.fc === 0) newCastling[color + "Q"] = false;
        if (move.fc === 7) newCastling[color + "K"] = false;
    }
    if (capturedPiece && typeOf(capturedPiece) === "R") {
        const ec = enemy(color);
        if (move.tr === (ec === COLOR.W ? 7 : 0)) {
            if (move.tc === 0) newCastling[ec + "Q"] = false;
            if (move.tc === 7) newCastling[ec + "K"] = false;
        }
    }
    return newCastling;
}

// Minimax with alpha-beta pruning
function minimax(board, depth, alpha, beta, isMaximizing, castling, enPassant) {
    if (depth === 0) {
        return evaluateBoard(board);
    }

    const color = isMaximizing ? COLOR.W : COLOR.B;
    const moves = allLegalMovesFrom(board, color, castling, enPassant);

    if (moves.length === 0) {
        if (isInCheck(board, color)) {
            // Checkmate
            return isMaximizing ? -99999 + (4 - depth) : 99999 - (4 - depth);
        }
        // Stalemate
        return 0;
    }

    // Move ordering: captures first for better pruning
    moves.sort((a, b) => {
        const aCap = board[a.tr][a.tc] ? 1 : 0;
        const bCap = board[b.tr][b.tc] ? 1 : 0;
        return bCap - aCap;
    });

    if (isMaximizing) {
        let maxEval = -Infinity;
        for (const move of moves) {
            const newBoard = cloneBoard(board);
            const piece = newBoard[move.fr][move.fc];
            const cap = newBoard[move.tr][move.tc];
            // Auto queen for promotions in AI
            if (move.promo) move.promoPiece = "Q";
            applyMoveToBoard(newBoard, move);
            const newCastling = updateCastlingRights(
                castling,
                newBoard,
                move,
                piece,
                cap,
            );
            let newEP = null;
            if (typeOf(piece) === "P" && Math.abs(move.tr - move.fr) === 2) {
                newEP = { r: (move.fr + move.tr) / 2, c: move.fc };
            }
            const ev = minimax(
                newBoard,
                depth - 1,
                alpha,
                beta,
                false,
                newCastling,
                newEP,
            );
            maxEval = Math.max(maxEval, ev);
            alpha = Math.max(alpha, ev);
            if (beta <= alpha) break;
        }
        return maxEval;
    } else {
        let minEval = Infinity;
        for (const move of moves) {
            const newBoard = cloneBoard(board);
            const piece = newBoard[move.fr][move.fc];
            const cap = newBoard[move.tr][move.tc];
            if (move.promo) move.promoPiece = "Q";
            applyMoveToBoard(newBoard, move);
            const newCastling = updateCastlingRights(
                castling,
                newBoard,
                move,
                piece,
                cap,
            );
            let newEP = null;
            if (typeOf(piece) === "P" && Math.abs(move.tr - move.fr) === 2) {
                newEP = { r: (move.fr + move.tr) / 2, c: move.fc };
            }
            const ev = minimax(
                newBoard,
                depth - 1,
                alpha,
                beta,
                true,
                newCastling,
                newEP,
            );
            minEval = Math.min(minEval, ev);
            beta = Math.min(beta, ev);
            if (beta <= alpha) break;
        }
        return minEval;
    }
}

function findBestMove() {
    const depth = DIFFICULTY_DEPTH[aiDifficulty] || 2;
    const moves = allLegalMoves(COLOR.B);

    if (moves.length === 0) return null;

    // Easy: random move
    if (aiDifficulty === "easy") {
        return moves[Math.floor(Math.random() * moves.length)];
    }

    let bestMove = null;
    let bestEval = Infinity; // AI is black, minimizing

    // Move ordering for root
    moves.sort((a, b) => {
        const aCap = state.board[a.tr][a.tc] ? 1 : 0;
        const bCap = state.board[b.tr][b.tc] ? 1 : 0;
        return bCap - aCap;
    });

    for (const move of moves) {
        const newBoard = cloneBoard(state.board);
        const piece = newBoard[move.fr][move.fc];
        const cap = newBoard[move.tr][move.tc];
        if (move.promo) move.promoPiece = "Q";
        applyMoveToBoard(newBoard, move);
        const newCastling = updateCastlingRights(
            state.castling,
            newBoard,
            move,
            piece,
            cap,
        );
        let newEP = null;
        if (typeOf(piece) === "P" && Math.abs(move.tr - move.fr) === 2) {
            newEP = { r: (move.fr + move.tr) / 2, c: move.fc };
        }
        const ev = minimax(
            newBoard,
            depth - 1,
            -Infinity,
            Infinity,
            true,
            newCastling,
            newEP,
        );

        if (ev < bestEval) {
            bestEval = ev;
            bestMove = move;
        }
    }

    return bestMove;
}

function scheduleAiMove() {
    if (state.gameOver || state.turn !== COLOR.B) return;

    aiThinking = true;
    renderStatus();

    // Use setTimeout to allow UI to update before heavy computation
    setTimeout(() => {
        const move = findBestMove();
        aiThinking = false;

        if (!move) {
            renderStatus();
            return;
        }

        lastMove = move;
        selectedSq = null;
        legalMoveSqs = [];

        // AI auto-promotes to queen
        const promoType = move.promo ? "Q" : null;
        executeMove(move, promoType);
    }, 300);
}

// ================================================
// EVENT LISTENERS
// ================================================
document.getElementById("btn-new-game").addEventListener("click", newGame);
document.getElementById("btn-undo").addEventListener("click", undoMove);
document.getElementById("btn-again").addEventListener("click", newGame);

window.addEventListener("resize", updateCoordSizes);

// ================================================
// BOOT
// ================================================
initState();
render();
showGameMenu();
