/**
 * Fix: Download cburnett again and properly add fill colors
 * The issue was some pieces use stroke-only (no fill attribute), so we need
 * to add fill to the parent group element.
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

function processWhite(svg) {
    let s = svg;
    // Replace existing white fills with cream
    s = s.replace(/fill="#fff"/g, 'fill="#f0d9b5"');
    s = s.replace(/fill="#ffffff"/g, 'fill="#f0d9b5"');
    // Darken stroke to brown
    s = s.replace(/stroke="#000"/g, 'stroke="#7a5230"');
    s = s.replace(/stroke="#000000"/g, 'stroke="#7a5230"');
    // If the g element has fill="none", add a background rect or change group fill
    // Actually push cream fill to group
    s = s.replace('<g fill="none"', '<g fill="#f0d9b5"');
    // Remove fill="none" that overrides group
    // Actually keep the explicit fill="none" for paths that should be transparent
    return s;
}

function processBlack(svg) {
    let s = svg;
    // Replace any white fills (details) with light tan
    s = s.replace(/fill="#fff"/g, 'fill="#c8a87a"');
    s = s.replace(/fill="#ffffff"/g, 'fill="#c8a87a"');
    // Replace black fills with dark brown
    s = s.replace(/fill="#000"/g, 'fill="#271e0e"');
    s = s.replace(/fill="#000000"/g, 'fill="#271e0e"');
    // Change the group fill from "none" to dark brown color
    s = s.replace('<g fill="none"', '<g fill="#3d2b1a"');
    // Darken stroke
    s = s.replace(/stroke="#000"/g, 'stroke="#1a0f05"');
    s = s.replace(/stroke="#000000"/g, 'stroke="#1a0f05"');
    // #ececec details should stay light
    return s;
}

async function main() {
    console.log("Processing cburnett SVGs with proper colors...\n");
    let downloaded = 0;

    for (const key of PIECES) {
        const result = await fetchText(`${BASE}/${key}.svg`);
        if (result.status !== 200 || !result.data.includes("<svg")) {
            console.log(`✗ ${key}: HTTP ${result.status}`);
            continue;
        }

        const isWhite = key.startsWith("w");
        let svg = isWhite
            ? processWhite(result.data)
            : processBlack(result.data);

        fs.writeFileSync(path.join(dir, `${key}.svg`), svg, "utf8");

        const fills = [...new Set(svg.match(/fill="[^"]+"/g) || [])];
        const strokes = [...new Set(svg.match(/stroke="[^"]+"/g) || [])];
        console.log(`✓ ${key}.svg`);
        console.log(`  fills: ${fills.slice(0, 4).join(", ")}`);
        downloaded++;
        await sleep(150);
    }

    console.log(`\nDone! ${downloaded}/12`);
}

main().catch(console.error);
