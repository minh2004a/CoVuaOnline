/**
 * Download "tatiana" chess piece set from Lichess - cartoon with filled colors
 */
const fs = require("fs");
const path = require("path");
const https = require("https");

const dir = path.join(__dirname, "images");
const BASE = "https://lichess1.org/assets/piece/tatiana";
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

function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        https
            .get(
                {
                    hostname: parsed.hostname,
                    path: parsed.pathname,
                    headers: {
                        "User-Agent":
                            "Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36",
                        Accept: "image/svg+xml,*/*",
                        Referer: "https://lichess.org/",
                    },
                },
                (res) => {
                    if (res.statusCode === 301 || res.statusCode === 302) {
                        return fetchUrl(res.headers.location)
                            .then(resolve)
                            .catch(reject);
                    }
                    let data = "";
                    res.on("data", (c) => (data += c));
                    res.on("end", () =>
                        resolve({ status: res.statusCode, data }),
                    );
                },
            )
            .on("error", reject);
    });
}

async function main() {
    console.log("Downloading tatiana piece set from Lichess...\n");
    let ok = 0;
    for (const key of PIECES) {
        const url = `${BASE}/${key}.svg`;
        const result = await fetchUrl(url);
        if (result.status === 200 && result.data.includes("<svg")) {
            fs.writeFileSync(path.join(dir, `${key}.svg`), result.data, "utf8");
            console.log(`✓ ${key}.svg (${result.data.length} bytes)`);
            ok++;
        } else {
            console.log(
                `✗ ${key}: HTTP ${result.status}, size: ${result.data.length}`,
            );
            if (result.data.length < 500)
                console.log(`  Content: ${result.data.substring(0, 200)}`);
        }
        await sleep(200);
    }
    console.log(`\nDone! ${ok}/12 pieces downloaded.`);
}

main().catch(console.error);
