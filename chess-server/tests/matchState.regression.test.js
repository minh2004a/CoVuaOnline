const test = require("node:test");
const assert = require("node:assert/strict");

const {
    createMatchState,
    applyMove,
    offerDraw,
    declineDraw,
    acceptDraw,
} = require("../matchState");

test("draw flow enforces offer/decline/accept semantics", () => {
    const state = createMatchState({ baseSeconds: 600, incrementSeconds: 0 });

    const offer = offerDraw(state, "white-socket");
    assert.equal(offer.ok, true);

    const selfAccept = acceptDraw(state, "white-socket");
    assert.equal(selfAccept.ok, false);
    assert.equal(selfAccept.code, "NO_PENDING_DRAW");

    const decline = declineDraw(state, "black-socket");
    assert.equal(decline.ok, true);
    assert.equal(decline.offeredBy, "white-socket");

    const secondOffer = offerDraw(state, "black-socket");
    assert.equal(secondOffer.ok, true);

    const accepted = acceptDraw(state, "white-socket");
    assert.equal(accepted.ok, true);
    assert.equal(accepted.result, "draw");
    assert.equal(accepted.reason, "draw");
});

test("any valid move clears pending draw offer", () => {
    const state = createMatchState({ baseSeconds: 600, incrementSeconds: 0 });

    const offer = offerDraw(state, "white-socket");
    assert.equal(offer.ok, true);
    assert.equal(state.drawOfferedBy, "white-socket");

    const result = applyMove(state, {
        playerColor: "w",
        move: { fr: 6, fc: 4, tr: 4, tc: 4 }, // e2 -> e4
    });
    assert.equal(result.status, "applied");
    assert.equal(state.drawOfferedBy, null);
});

test("server rejects illegal or out-of-turn moves", () => {
    const state = createMatchState({ baseSeconds: 600, incrementSeconds: 0 });

    const outOfTurn = applyMove(state, {
        playerColor: "b",
        move: { fr: 1, fc: 4, tr: 3, tc: 4 }, // e7 -> e5, but white to move.
    });
    assert.equal(outOfTurn.status, "rejected");
    assert.equal(outOfTurn.code, "NOT_YOUR_TURN");

    const illegal = applyMove(state, {
        playerColor: "w",
        move: { fr: 7, fc: 4, tr: 5, tc: 4 }, // King e1 -> e3 illegal at start.
    });
    assert.equal(illegal.status, "rejected");
    assert.equal(illegal.code, "ILLEGAL_MOVE");
});
