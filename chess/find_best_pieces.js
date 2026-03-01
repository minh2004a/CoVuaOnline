/**
 * Test and download the best cartoon-style chess pieces from Lichess
 * that matches Chess.com style (filled, colored, illustrated)
 */
const fs = require("fs");
const path = require("path");
const https = require("https");

const dir = path.join(__dirname, "images");

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

// More piece sets to try
const SETS_TO_TEST = [
    "maestro", // filled, illustrated - likely best
    "tatiana", // illustrated with color
    "california", // filled with nice colors
    "pirouetti", // cartoon
    "reillycraig", // modern illustrated
    "pixel", // pixel art
    "letter", // letter style
    "governor", //
    "dubrovny", //
    "shapes", //
    "kosal", //
    "gioco", //
    "icpieces", //
    "staunty", //
];

async function main() {
    console.log("Testing piece sets from Lichess CDN...\n");
    let workingSets = [];

    for (const setName of SETS_TO_TEST) {
        const testUrl = `https://lichess1.org/assets/piece/${setName}/wK.svg`;
        try {
            const result = await fetchUrl(testUrl);
            const isSvg =
                result.data.includes("<svg") || result.data.includes("<?xml");
            const size = result.data.length;
            if (isSvg && result.status === 200) {
                // Check if it's "filled" style (has fill colors other than white/none)
                const hasFill =
                    result.data.includes('fill="#') &&
                    !result.data.includes('fill="none"') &&
                    result.data.match(/fill="#[0-9a-fA-F]{3,6}"/g)?.length > 1;
                console.log(
                    `✓ ${setName.padEnd(15)} size=${size.toString().padStart(5)} filled=${hasFill}`,
                );
                workingSets.push({ name: setName, size, hasFill });
            } else {
                console.log(`✗ ${setName.padEnd(15)} HTTP ${result.status}`);
            }
        } catch (e) {
            console.log(`✗ ${setName.padEnd(15)} Error: ${e.message}`);
        }
        await sleep(150);
    }

    console.log("\n=== Working sets sorted by size ===");
    workingSets.sort((a, b) => b.size - a.size);
    workingSets.forEach((s) =>
        console.log(
            `  ${s.name.padEnd(15)} ${s.size} bytes, filled: ${s.hasFill}`,
        ),
    );

    // Try the largest one that's filled
    const best = workingSets.find((s) => s.hasFill) || workingSets[0];
    if (best) {
        console.log(`\n=== Downloading best set: ${best.name} ===`);
        const pieces = [
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
        let ok = 0;
        for (const key of pieces) {
            const url = `https://lichess1.org/assets/piece/${best.name}/${key}.svg`;
            const result = await fetchUrl(url);
            if (result.status === 200 && result.data.includes("<svg")) {
                fs.writeFileSync(
                    path.join(dir, `${key}.svg`),
                    result.data,
                    "utf8",
                );
                console.log(`  ✓ ${key}.svg (${result.data.length} bytes)`);
                ok++;
            } else {
                console.log(`  ✗ ${key}: HTTP ${result.status}`);
            }
            await sleep(150);
        }
        console.log(`\nDownloaded ${ok}/12 pieces from ${best.name} set`);
    }
}

main().catch(console.error);
