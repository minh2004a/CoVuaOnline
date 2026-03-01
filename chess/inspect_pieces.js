/**
 * Download chess piece PNGs from open sources
 * Using Wikipedia Chess pieces (Cburnett set) via rawgit/GitHub
 * or Chess.com via API
 */
const fs = require("fs");
const path = require("path");
const https = require("https");

const dir = path.join(__dirname, "images");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fetchBinary(url) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const options = {
            hostname: parsed.hostname,
            path: parsed.pathname + parsed.search,
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
                Accept: "*/*",
            },
        };
        https
            .get(options, (res) => {
                if (res.statusCode === 301 || res.statusCode === 302) {
                    return fetchBinary(res.headers.location)
                        .then(resolve)
                        .catch(reject);
                }
                const chunks = [];
                res.on("data", (c) => chunks.push(c));
                res.on("end", () =>
                    resolve({
                        status: res.statusCode,
                        data: Buffer.concat(chunks),
                        contentType: res.headers["content-type"] || "",
                    }),
                );
            })
            .on("error", reject);
    });
}

// Use the niklasf/chessground-assets on GitHub for high-quality illustrated pieces
// These are openly licensed SVGs used by Lichess
const SOURCES = [
    {
        name: "kosal (Lichess)",
        base: "https://lichess1.org/assets/piece/kosal",
        ext: "svg",
    },
    {
        name: "staunty (Lichess)",
        base: "https://lichess1.org/assets/piece/staunty",
        ext: "svg",
    },
    {
        name: "maestro (Lichess)",
        base: "https://lichess1.org/assets/piece/maestro",
        ext: "svg",
    },
    {
        name: "california (Lichess)",
        base: "https://lichess1.org/assets/piece/california",
        ext: "svg",
    },
];

const PIECES = [
    "wK",
    "wQ",
    "wR",
    "wB",
    "wN",
    "wP",
    "bK",
    "bQ",
    "bR",
    "bB",
    "bN",
    "bP",
];

async function testSource(source) {
    const url = `${source.base}/wK.${source.ext}`;
    try {
        const result = await fetchBinary(url);
        const content = result.data.toString("utf8");
        const isSvg = content.includes("<svg") || content.includes("<?xml");
        const size = result.data.length;

        // Check for filled/colored style
        const fillMatches = content.match(/fill="#[0-9a-fA-F]{3,6}"/g) || [];
        const uniqueFills = [...new Set(fillMatches)];
        const hasRealColor = uniqueFills.some(
            (f) =>
                !f.includes("fff") &&
                !f.includes("FFF") &&
                !f.includes("000") &&
                !f.includes("000000") &&
                !f.includes("ffffff"),
        );

        return {
            ok: isSvg && result.status === 200,
            size,
            fills: uniqueFills.length,
            hasRealColor,
            sample: content.substring(0, 300),
        };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

async function downloadSet(source) {
    let ok = 0;
    for (const key of PIECES) {
        const url = `${source.base}/${key}.${source.ext}`;
        const result = await fetchBinary(url);
        if (result.status === 200) {
            fs.writeFileSync(path.join(dir, `${key}.svg`), result.data);
            console.log(`  ✓ ${key}.svg (${result.data.length}b)`);
            ok++;
        } else {
            console.log(`  ✗ ${key}: HTTP ${result.status}`);
        }
        await sleep(100);
    }
    return ok;
}

async function main() {
    console.log("=== Testing piece sets ===\n");

    for (const source of SOURCES) {
        const info = await testSource(source);
        console.log(
            `${source.name}: ok=${info.ok} size=${info.size} fills=${info.fills} hasRealColor=${info.hasRealColor}`,
        );
        await sleep(100);
    }

    // Pick maestro - it's the most detailed
    const chosen = SOURCES.find((s) => s.name.includes("maestro"));
    console.log(`\n=== Downloading ${chosen.name} ===`);
    const downloaded = await downloadSet(chosen);
    console.log(`\nDone! ${downloaded}/12`);

    // Show sample of wK to see what it looks like
    const wK = fs.readFileSync(path.join(dir, "wK.svg"), "utf8");
    console.log("\n=== wK.svg sample (first 500 chars) ===");
    console.log(wK.substring(0, 500));

    // Show fill colors
    const fills = wK.match(/fill="[^"]+"/g) || [];
    console.log("\n=== Fill colors in wK ===");
    console.log([...new Set(fills)].join(", "));
}

main().catch(console.error);
