const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const GAME_ROOMS_PATH = path.join(__dirname, "..", "gameRooms.js");

function loadFreshGameRooms() {
    delete require.cache[require.resolve(GAME_ROOMS_PATH)];
    return require(GAME_ROOMS_PATH);
}

test("duplicate account on multiple tabs cannot join queue twice", () => {
    const gameRooms = loadFreshGameRooms();

    const firstJoin = gameRooms.joinQueue({
        socketId: "socket-tab-1",
        userId: "same-user-id",
        name: "Player",
        rating: 300,
        timeControlId: "10|0",
    });
    assert.ok(firstJoin);

    const duplicateJoin = gameRooms.joinQueue({
        socketId: "socket-tab-2",
        userId: "same-user-id",
        name: "Player",
        rating: 300,
        timeControlId: "10|0",
    });
    assert.equal(duplicateJoin, false);
    assert.equal(gameRooms.getQueuePosition("socket-tab-1"), 1);
    assert.equal(gameRooms.getQueuePosition("socket-tab-2"), null);
});

