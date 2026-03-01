/**
 * Download cburnett pieces and color-process them:
 * - White pieces: fill = #f0d9b5 (cream/ivory), stroke = #b58863 (brown)
 * - Black pieces: fill = #b58863 (dark brown), stroke = #1a1a1a (very dark)
 * This gives the exact Chess.com look.
 */
const fs = require("fs");
const path = require("path");
const https = require("https");

const dir = path.join(__dirname, "images");
const BASE = "https://lichess1.org/assets/piece/cburnett";
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

function fetchText(url) {
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

function colorizeWhite(svg) {
    // White pieces: cream fill, brown stroke
    // Replace fill="#fff" with cream
    let result = svg;
    // Add cream fill to the main piece body
    result = result.replace(/fill="#fff"/g, 'fill="#f0d9b5"');
    result = result.replace(/fill="#ffffff"/g, 'fill="#f0d9b5"');
    result = result.replace(/fill="white"/g, 'fill="#f0d9b5"');
    // Darken the stroke a bit
    result = result.replace(/stroke="#000"/g, 'stroke="#5a3808"');
    result = result.replace(/stroke="#000000"/g, 'stroke="#5a3808"');
    result = result.replace(/stroke="black"/g, 'stroke="#5a3808"');
    // Stroke width - make slightly thicker
    result = result.replace(/stroke-width="1\.5"/g, 'stroke-width="1.8"');
    return result;
}

function colorizeBlack(svg) {
    // Black pieces: dark brown fill with cream details
    let result = svg;
    // The black pieces use fill="#000"/"#000000" for the main body
    // and fill="#fff" for details

    // Replace black fill with dark brown
    result = result.replace(/fill="#000"/g, 'fill="#271e0e"');
    result = result.replace(/fill="#000000"/g, 'fill="#271e0e"');
    result = result.replace(/fill="black"/g, 'fill="#271e0e"');

    // Replace white details with lighter color
    result = result.replace(/fill="#fff"/g, 'fill="#c8a87a"');
    result = result.replace(/fill="#ffffff"/g, 'fill="#c8a87a"');
    result = result.replace(/fill="white"/g, 'fill="#c8a87a"');

    // Stroke
    result = result.replace(/stroke="#000"/g, 'stroke="#1a0f05"');
    result = result.replace(/stroke="#000000"/g, 'stroke="#1a0f05"');
    result = result.replace(/stroke="black"/g, 'stroke="#1a0f05"');

    return result;
}

async function main() {
    console.log("Downloading cburnett pieces and colorizing...\n");
    let ok = 0;
    for (const key of PIECES) {
        const result = await fetchText(`${BASE}/${key}.svg`);
        if (result.status !== 200 || !result.data.includes("<svg")) {
            console.log(`✗ ${key}: HTTP ${result.status}`);
            continue;
        }

        let svg = result.data;
        const isWhite = key.startsWith("w");

        // Show original fills
        const origFills = [...new Set(svg.match(/fill="[^"]+"/g) || [])];

        // Colorize
        svg = isWhite ? colorizeWhite(svg) : colorizeBlack(svg);

        // Show new fills
        const newFills = [...new Set(svg.match(/fill="[^"]+"/g) || [])];

        fs.writeFileSync(path.join(dir, `${key}.svg`), svg, "utf8");
        console.log(`✓ ${key}.svg`);
        console.log(`  Before: ${origFills.join(", ")}`);
        console.log(`  After:  ${newFills.join(", ")}`);
        ok++;
        await sleep(200);
    }

    console.log(`\nDone! ${ok}/12 pieces colorized.`);
}

main().catch(console.error);
