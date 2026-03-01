/**
 * Ghi trực tiếp SVG quân cờ cartoon style vào thư mục images.
 * Sử dụng bộ "Chess.com Merida/Neo" style - cartoon, outlined, filled.
 * Màu sắc: trắng = #f0d9b5 (cream), đen = #b58863 (brown-dark)
 * Outline: đen đậm, kiểu cartoon.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const dir = path.join(__dirname, "images");

// Bộ quân cờ "Horsey" từ Lichess (open source, đẹp cartoon)
// https://github.com/niklasf/chess-pieces
// Sử dụng bộ "cburnett" nâng cấp từ Lichess CDN
const PIECES = {
    wK: "https://lichess1.org/assets/piece/cburnett/wK.svg",
    wQ: "https://lichess1.org/assets/piece/cburnett/wQ.svg",
    wR: "https://lichess1.org/assets/piece/cburnett/wR.svg",
    wB: "https://lichess1.org/assets/piece/cburnett/wB.svg",
    wN: "https://lichess1.org/assets/piece/cburnett/wN.svg",
    wP: "https://lichess1.org/assets/piece/cburnett/wP.svg",
    bK: "https://lichess1.org/assets/piece/cburnett/bK.svg",
    bQ: "https://lichess1.org/assets/piece/cburnett/bQ.svg",
    bR: "https://lichess1.org/assets/piece/cburnett/bR.svg",
    bB: "https://lichess1.org/assets/piece/cburnett/bB.svg",
    bN: "https://lichess1.org/assets/piece/cburnett/bN.svg",
    bP: "https://lichess1.org/assets/piece/cburnett/bP.svg",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: new URL(url).hostname,
            path: new URL(url).pathname,
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
                Accept: "image/svg+xml,*/*",
                Referer: "https://lichess.org/",
            },
        };
        https
            .get(options, (res) => {
                if (res.statusCode === 301 || res.statusCode === 302) {
                    // Follow redirect
                    return downloadFile(res.headers.location, dest)
                        .then(resolve)
                        .catch(reject);
                }
                let data = "";
                res.on("data", (c) => (data += c));
                res.on("end", () => {
                    if (res.statusCode !== 200) {
                        console.error(`  HTTP ${res.statusCode} for ${url}`);
                        return resolve(false);
                    }
                    if (!data.includes("<svg") && !data.includes("<SVG")) {
                        console.error(`  Not SVG content for ${dest}`);
                        console.error(
                            `  First 200 chars: ${data.substring(0, 200)}`,
                        );
                        return resolve(false);
                    }
                    fs.writeFileSync(dest, data, "utf8");
                    console.log(
                        `  ✓ Saved ${path.basename(dest)} (${data.length} bytes)`,
                    );
                    resolve(true);
                });
            })
            .on("error", (e) => {
                console.error(`  Error: ${e.message}`);
                resolve(false);
            });
    });
}

async function main() {
    console.log("Downloading chess piece SVGs from Lichess CDN...\n");
    let successCount = 0;
    for (const [key, url] of Object.entries(PIECES)) {
        console.log(`Downloading ${key}...`);
        const dest = path.join(dir, `${key}.svg`);
        const ok = await downloadFile(url, dest);
        if (ok) successCount++;
        await sleep(300);
    }
    console.log(
        `\nDone! ${successCount}/${Object.keys(PIECES).length} pieces downloaded.`,
    );
    if (successCount < Object.keys(PIECES).length) {
        console.log(
            "\nSome pieces failed. Try running again or check network connection.",
        );
    }
}

main().catch(console.error);
