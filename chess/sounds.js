/**
 * ================================================
 * CHESS SOUNDS — Web Audio API Sound Engine
 * No external files needed — all sounds generated
 * programmatically using oscillators & envelopes.
 * ================================================
 */
const ChessSounds = (() => {
    let ctx = null;

    // Lazy-init AudioContext (must be triggered by user gesture)
    function getCtx() {
        if (!ctx) {
            ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (ctx.state === "suspended") {
            ctx.resume();
        }
        return ctx;
    }

    // ── Helper: play a tone with envelope ──────────────────────
    function playTone(freq, duration, type = "sine", volume = 0.3, delay = 0) {
        const c = getCtx();
        const osc = c.createOscillator();
        const gain = c.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, c.currentTime + delay);

        gain.gain.setValueAtTime(0, c.currentTime + delay);
        gain.gain.linearRampToValueAtTime(volume, c.currentTime + delay + 0.01);
        gain.gain.exponentialRampToValueAtTime(
            0.001,
            c.currentTime + delay + duration,
        );

        osc.connect(gain);
        gain.connect(c.destination);

        osc.start(c.currentTime + delay);
        osc.stop(c.currentTime + delay + duration);
    }

    // ── Helper: noise burst (for snappy sounds) ────────────────
    function playNoise(duration, volume = 0.15, delay = 0) {
        const c = getCtx();
        const bufferSize = c.sampleRate * duration;
        const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * 0.5;
        }

        const source = c.createBufferSource();
        source.buffer = buffer;

        const gain = c.createGain();
        gain.gain.setValueAtTime(volume, c.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(
            0.001,
            c.currentTime + delay + duration,
        );

        const filter = c.createBiquadFilter();
        filter.type = "highpass";
        filter.frequency.value = 2000;

        source.connect(filter);
        filter.connect(gain);
        gain.connect(c.destination);

        source.start(c.currentTime + delay);
        source.stop(c.currentTime + delay + duration);
    }

    // ════════════════════════════════════════════════════════════
    // PUBLIC METHODS
    // ════════════════════════════════════════════════════════════

    /** Normal piece move — short woody "tock" */
    function move() {
        playTone(800, 0.08, "triangle", 0.25);
        playNoise(0.04, 0.08);
    }

    /** Capture — snappy hit */
    function capture() {
        playTone(400, 0.12, "sawtooth", 0.2);
        playNoise(0.06, 0.18);
        playTone(250, 0.1, "triangle", 0.15, 0.03);
    }

    /** Castling — two quick tocks */
    function castling() {
        playTone(700, 0.08, "triangle", 0.25, 0);
        playNoise(0.03, 0.06, 0);
        playTone(900, 0.08, "triangle", 0.25, 0.12);
        playNoise(0.03, 0.06, 0.12);
    }

    /** Check — sharp warning tone */
    function check() {
        playTone(880, 0.15, "square", 0.2);
        playTone(1100, 0.12, "square", 0.15, 0.08);
    }

    /** Checkmate — triumphant fanfare */
    function checkmate() {
        playTone(523, 0.2, "triangle", 0.3, 0); // C5
        playTone(659, 0.2, "triangle", 0.3, 0.15); // E5
        playTone(784, 0.2, "triangle", 0.3, 0.3); // G5
        playTone(1047, 0.4, "triangle", 0.35, 0.45); // C6
    }

    /** Stalemate / Draw — descending sad tone */
    function stalemate() {
        playTone(440, 0.25, "sine", 0.2, 0); // A4
        playTone(370, 0.25, "sine", 0.18, 0.2); // F#4
        playTone(330, 0.4, "sine", 0.15, 0.4); // E4
    }

    /** Pawn promotion — bright ascending ding */
    function promote() {
        playTone(660, 0.12, "sine", 0.25, 0);
        playTone(880, 0.12, "sine", 0.3, 0.08);
        playTone(1320, 0.2, "sine", 0.25, 0.16);
    }

    /** Game start — fresh start chime */
    function gameStart() {
        playTone(523, 0.1, "sine", 0.2, 0); // C5
        playTone(659, 0.1, "sine", 0.2, 0.1); // E5
        playTone(784, 0.15, "sine", 0.25, 0.2); // G5
    }

    /** Select a piece — soft click */
    function select() {
        playTone(1200, 0.04, "sine", 0.12);
    }

    /** Illegal action — error buzz */
    function illegal() {
        playTone(200, 0.15, "sawtooth", 0.12);
        playTone(180, 0.12, "sawtooth", 0.1, 0.08);
    }

    function clockWarning() {
        playTone(1200, 0.06, "square", 0.08);
    }

    // ── Expose API ─────────────────────────────────────────────
    return {
        move,
        capture,
        castling,
        check,
        checkmate,
        stalemate,
        promote,
        gameStart,
        select,
        illegal,
        clockWarning,
    };
})();
