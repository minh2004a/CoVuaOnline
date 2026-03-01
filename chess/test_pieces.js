/**
 * Download chess pieces - thử nhiều nguồn khác nhau
 */
const fs = require("fs");
const path = require("path");
const https = require("https");

const dir = path.join(__dirname, "images");

// Thử các CDN khác nhau của Lichess
// Bộ "horsey" = cartoon style nhất
const PIECE_SETS = [
    "horsey", // cartoon horse knight
    "chess7", // modern cartoon
    "merida", // classic chess.com style
    "alpha", // minimal
    "cburnett", // standard
];

// Sử dụng bộ "chess7" - modern cartoon style
const BASE = "https://lichess1.org/assets/piece/chess7";
const PIECES = {
    wK: `${BASE}/wK.svg`,
    wQ: `${BASE}/wQ.svg`,
    wR: `${BASE}/wR.svg`,
    wB: `${BASE}/wB.svg`,
    wN: `${BASE}/wN.svg`,
    wP: `${BASE}/wP.svg`,
    bK: `${BASE}/bK.svg`,
    bQ: `${BASE}/bQ.svg`,
    bR: `${BASE}/bR.svg`,
    bB: `${BASE}/bB.svg`,
    bN: `${BASE}/bN.svg`,
    bP: `${BASE}/bP.svg`,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const options = {
            hostname: parsed.hostname,
            path: parsed.pathname + parsed.search,
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
                Accept: "image/svg+xml,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                Referer: "https://lichess.org/",
            },
        };
        https
            .get(options, (res) => {
                if (res.statusCode === 301 || res.statusCode === 302) {
                    return fetchUrl(res.headers.location)
                        .then(resolve)
                        .catch(reject);
                }
                let data = "";
                res.on("data", (c) => (data += c));
                res.on("end", () => resolve({ status: res.statusCode, data }));
            })
            .on("error", reject);
    });
}

async function main() {
    // Test các bộ pieces khác nhau
    for (const setName of PIECE_SETS) {
        console.log(`\nTesting piece set: ${setName}`);
        const testUrl = `https://lichess1.org/assets/piece/${setName}/wK.svg`;
        try {
            const result = await fetchUrl(testUrl);
            const isSvg =
                result.data.includes("<svg") || result.data.includes("<?xml");
            console.log(
                `  HTTP ${result.status}, isSVG: ${isSvg}, size: ${result.data.length}`,
            );
            if (isSvg && result.status === 200) {
                console.log(`  ✓ ${setName} works!`);
            }
        } catch (e) {
            console.log(`  Error: ${e.message}`);
        }
        await sleep(200);
    }

    // Download với bộ chess7
    console.log("\n\nDownloading with chess7 set...");
    let ok = 0;
    for (const [key, url] of Object.entries(PIECES)) {
        const result = await fetchUrl(url);
        if (
            result.status === 200 &&
            (result.data.includes("<svg") || result.data.includes("<?xml"))
        ) {
            fs.writeFileSync(path.join(dir, `${key}.svg`), result.data, "utf8");
            console.log(`✓ ${key}.svg (${result.data.length} bytes)`);
            ok++;
        } else {
            console.log(`✗ ${key}: HTTP ${result.status}`);
        }
        await sleep(200);
    }
    console.log(`\nDone! ${ok}/12`);
}

main().catch(console.error);
