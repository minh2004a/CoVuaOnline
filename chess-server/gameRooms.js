/**
 * Matchmaking queue and active room state.
 *
 * Queue item:
 * {
 *   socketId,
 *   userId,
 *   name,
 *   rating,
 *   queuedAt
 * }
 */
const queue = [];

const DEFAULT_QUEUE_RATING = 300;
const DEFAULT_BASE_RATING_GAP = 10;
const DEFAULT_GAP_GROWTH_PER_SECOND = 3;
const DEFAULT_MAX_RATING_GAP = 500;

function parsePositiveNumber(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
}

const MATCH_BASE_RATING_GAP = parsePositiveNumber(
    process.env.MATCH_BASE_RATING_GAP,
    DEFAULT_BASE_RATING_GAP,
);
const MATCH_GAP_GROWTH_PER_SECOND = parsePositiveNumber(
    process.env.MATCH_GAP_GROWTH_PER_SECOND,
    DEFAULT_GAP_GROWTH_PER_SECOND,
);
const MATCH_MAX_RATING_GAP = parsePositiveNumber(
    process.env.MATCH_MAX_RATING_GAP,
    DEFAULT_MAX_RATING_GAP,
);

/**
 * Room shape:
 * {
 *   roomId,
 *   whiteSocketId,
 *   blackSocketId,
 *   whiteUserId,
 *   blackUserId,
 *   whiteName,
 *   blackName,
 *   whiteRating,
 *   blackRating,
 *   createdAt
 * }
 */
const rooms = new Map();

// Map socket id -> room id
const playerRoom = new Map();

function joinQueue(player) {
    if (!player?.socketId || !player?.userId) return false;

    const duplicatedSocket = queue.some(
        (item) => item.socketId === player.socketId,
    );
    const duplicatedUser = queue.some((item) => item.userId === player.userId);
    if (duplicatedSocket || duplicatedUser) return false;

    queue.push({
        socketId: player.socketId,
        userId: player.userId,
        name: player.name || "Player",
        rating: Number.isFinite(player.rating)
            ? player.rating
            : DEFAULT_QUEUE_RATING,
        queuedAt: Date.now(),
    });
    return true;
}

function leaveQueue(socketId) {
    const idx = queue.findIndex((p) => p.socketId === socketId);
    if (idx !== -1) queue.splice(idx, 1);
}

function getQueuePosition(socketId) {
    const idx = queue.findIndex((item) => item.socketId === socketId);
    return idx === -1 ? null : idx + 1;
}

function tryMatch() {
    if (queue.length < 2) return null;

    const now = Date.now();
    for (let i = 0; i < queue.length - 1; i += 1) {
        const seeker = queue[i];
        const seekerGap = currentAllowedGap(seeker, now);

        let bestIdx = -1;
        let bestDiff = Number.POSITIVE_INFINITY;

        for (let j = i + 1; j < queue.length; j += 1) {
            const candidate = queue[j];
            const diff = Math.abs(seeker.rating - candidate.rating);
            const candidateGap = currentAllowedGap(candidate, now);

            if (diff > seekerGap || diff > candidateGap) continue;
            if (diff >= bestDiff) continue;

            bestDiff = diff;
            bestIdx = j;
        }

        if (bestIdx === -1) continue;

        const p2 = queue.splice(bestIdx, 1)[0];
        const p1 = queue.splice(i, 1)[0];
        const [white, black] = Math.random() < 0.5 ? [p1, p2] : [p2, p1];
        const roomId = generateRoomId();
        const room = {
            roomId,
            whiteSocketId: white.socketId,
            blackSocketId: black.socketId,
            whiteUserId: white.userId,
            blackUserId: black.userId,
            whiteName: white.name,
            blackName: black.name,
            whiteRating: white.rating,
            blackRating: black.rating,
            createdAt: Date.now(),
        };

        rooms.set(roomId, room);
        playerRoom.set(white.socketId, roomId);
        playerRoom.set(black.socketId, roomId);

        return {
            roomId,
            white,
            black,
            room,
        };
    }

    return null;
}

function getRoom(roomId) {
    return rooms.get(roomId) || null;
}

function getRoomForPlayer(socketId) {
    return playerRoom.get(socketId) || null;
}

function closeRoom(roomId) {
    const room = rooms.get(roomId);
    if (!room) return null;
    playerRoom.delete(room.whiteSocketId);
    playerRoom.delete(room.blackSocketId);
    rooms.delete(roomId);
    return room;
}

function removePlayer(socketId) {
    leaveQueue(socketId);
    const roomId = getRoomForPlayer(socketId);
    if (!roomId) return null;
    closeRoom(roomId);
    return roomId;
}

function isPlayerInRoom(roomId, socketId) {
    const room = rooms.get(roomId);
    if (!room) return false;
    return room.whiteSocketId === socketId || room.blackSocketId === socketId;
}

function getOpponent(roomId, mySocketId) {
    const room = rooms.get(roomId);
    if (!room) return null;
    if (room.whiteSocketId === mySocketId) return room.blackSocketId;
    if (room.blackSocketId === mySocketId) return room.whiteSocketId;
    return null;
}

function generateRoomId() {
    return Math.random().toString(36).slice(2, 10).toUpperCase();
}

function currentAllowedGap(player, nowTs) {
    const now = Number.isFinite(nowTs) ? nowTs : Date.now();
    const queuedAt = Number.isFinite(player?.queuedAt) ? player.queuedAt : now;
    const waitedSeconds = Math.max(0, (now - queuedAt) / 1000);
    const dynamicGap =
        MATCH_BASE_RATING_GAP + waitedSeconds * MATCH_GAP_GROWTH_PER_SECOND;
    return Math.min(MATCH_MAX_RATING_GAP, dynamicGap);
}

function getStats() {
    return {
        queueLength: queue.length,
        activeRooms: rooms.size,
    };
}

module.exports = {
    joinQueue,
    leaveQueue,
    getQueuePosition,
    tryMatch,
    getRoom,
    getRoomForPlayer,
    closeRoom,
    removePlayer,
    isPlayerInRoom,
    getOpponent,
    getStats,
};
