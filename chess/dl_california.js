/**
 * Download "california" piece set from Lichess - most detailed/largest
 */
const fs = require("fs");
const path = require("path");
const https = require("https");

const dir = path.join(__dirname, "images");
const BASE = "https://lichess1.org/assets/piece/california";
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fetch(url) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        https
            .get(
                {
                    hostname: parsed.hostname,
                    path: parsed.pathname,
                    headers: {
                        "User-Agent": "Mozilla/5.0 Chrome/120",
                        Referer: "https://lichess.org/",
                    },
                },
                (res) => {
                    const chunks = [];
                    res.on("data", (c) => chunks.push(c));
                    res.on("end", () =>
                        resolve({
                            status: res.statusCode,
                            data: Buffer.concat(chunks),
                        }),
                    );
                },
            )
            .on("error", reject);
    });
}

async function main() {
    console.log("Downloading california piece set...\n");
    let ok = 0;
    for (const key of PIECES) {
        const result = await fetch(`${BASE}/${key}.svg`);
        if (result.status === 200) {
            fs.writeFileSync(path.join(dir, `${key}.svg`), result.data);
            console.log(`✓ ${key}.svg (${result.data.length}b)`);
            ok++;
        } else {
            console.log(`✗ ${key}: HTTP ${result.status}`);
        }
        await sleep(150);
    }
    console.log(`\nDone! ${ok}/12`);
}

main().catch(console.error);
