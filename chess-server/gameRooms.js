/**
 * Matchmaking queue and active room state.
 *
 * Queue item:
 * {
 *   socketId,
 *   userId,
 *   name,
 *   rating
 * }
 */
const queue = [];

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
        rating: Number.isFinite(player.rating) ? player.rating : 1200,
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

    const p1 = queue.shift();
    const p2 = queue.shift();

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
