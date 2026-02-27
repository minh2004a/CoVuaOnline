/**
 * ================================================
 * GAME ROOMS & MATCHMAKING
 * Manages queue and active game rooms
 * ================================================
 */

// Queue of players waiting for a match: [{ socketId, name }]
const queue = [];

// Active rooms: Map<roomId, RoomObject>
// RoomObject: { white: socketId, black: socketId, whiteName, blackName, createdAt }
const rooms = new Map();

// Map socketId → roomId (to find room when player disconnects)
const playerRoom = new Map();

/**
 * Add a player to the matchmaking queue.
 * Returns false if they are already in queue.
 */
function joinQueue(socketId, name) {
    // Don't add duplicates
    if (queue.find((p) => p.socketId === socketId)) return false;
    queue.push({ socketId, name: name || "Anonymous" });
    return true;
}

/**
 * Remove a player from queue (e.g., they cancelled).
 */
function leaveQueue(socketId) {
    const idx = queue.findIndex((p) => p.socketId === socketId);
    if (idx !== -1) queue.splice(idx, 1);
}

/**
 * Try to match the first 2 players in queue.
 * Returns { roomId, white, black } or null.
 */
function tryMatch() {
    if (queue.length < 2) return null;

    const p1 = queue.shift();
    const p2 = queue.shift();

    // Randomly assign colors
    const [white, black] = Math.random() < 0.5 ? [p1, p2] : [p2, p1];

    const roomId = generateRoomId();
    const room = {
        white: white.socketId,
        black: black.socketId,
        whiteName: white.name,
        blackName: black.name,
        createdAt: Date.now(),
    };

    rooms.set(roomId, room);
    playerRoom.set(white.socketId, roomId);
    playerRoom.set(black.socketId, roomId);

    return {
        roomId,
        white: { socketId: white.socketId, name: white.name },
        black: { socketId: black.socketId, name: black.name },
    };
}

/**
 * Get room by roomId.
 */
function getRoom(roomId) {
    return rooms.get(roomId) || null;
}

/**
 * Get roomId for a given player socketId.
 */
function getRoomForPlayer(socketId) {
    return playerRoom.get(socketId) || null;
}

/**
 * Remove a player from their room (disconnect handler).
 * Returns the roomId they were in, or null.
 */
function removePlayer(socketId) {
    // Remove from queue if waiting
    leaveQueue(socketId);

    // Remove from active room
    const roomId = playerRoom.get(socketId);
    if (roomId) {
        playerRoom.delete(socketId);

        const room = rooms.get(roomId);
        if (room) {
            // Also remove the other player's playerRoom mapping
            const otherSocket =
                room.white === socketId ? room.black : room.white;
            playerRoom.delete(otherSocket);
            rooms.delete(roomId);
        }
        return roomId;
    }
    return null;
}

/**
 * Get the opponent's socketId in a room.
 */
function getOpponent(roomId, mySocketId) {
    const room = rooms.get(roomId);
    if (!room) return null;
    return room.white === mySocketId ? room.black : room.white;
}

/**
 * Generate a random 8-char alphanumeric room ID.
 */
function generateRoomId() {
    return Math.random().toString(36).substring(2, 10).toUpperCase();
}

/**
 * Get stats for debugging.
 */
function getStats() {
    return {
        queueLength: queue.length,
        activeRooms: rooms.size,
    };
}

module.exports = {
    joinQueue,
    leaveQueue,
    tryMatch,
    getRoom,
    getRoomForPlayer,
    removePlayer,
    getOpponent,
    getStats,
};
