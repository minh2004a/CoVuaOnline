/**
 * Fetch chess piece SVGs directly from GitHub - bộ "chess-pieces" nổi tiếng
 * Source: https://github.com/lichess-org/lila/tree/master/public/piece
 */
const fs = require("fs");
const path = require("path");
const https = require("https");

const dir = path.join(__dirname, "images");
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
                        Accept: "*/*",
                    },
                },
                (res) => {
                    if (res.statusCode === 301 || res.statusCode === 302) {
                        return fetch(res.headers.location)
                            .then(resolve)
                            .catch(reject);
                    }
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

// Try various GitHub raw sources for chess SVGs
const SOURCES_TO_TRY = [
    // Merida - classic Chess.com style, filled and detailed
    {
        name: "merida (lichess)",
        base: "https://lichess1.org/assets/piece/merida",
        keys: [
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
        ],
    },
    // Horsey - cartoon knight style
    {
        name: "horsey (lichess)",
        base: "https://lichess1.org/assets/piece/horsey",
        keys: [
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
        ],
    },
];

async function main() {
    for (const source of SOURCES_TO_TRY) {
        console.log(`\nTesting: ${source.name}`);
        const testKey = source.keys[0];
        const url = `${source.base}/${testKey}.svg`;
        const result = await fetch(url);
        const content = result.data.toString("utf8");
        const isSvg = content.includes("<svg") || content.includes("<?xml");
        console.log(
            `  HTTP ${result.status}, isSVG: ${isSvg}, size: ${content.length}`,
        );

        if (isSvg && result.status === 200) {
            // Check fill colors
            const fills = content.match(/fill="[^"]+"/g) || [];
            const uniqueFills = [...new Set(fills)];
            console.log(`  Fills: ${uniqueFills.join(", ")}`);
        }
        await sleep(200);
    }

    // Download merida
    console.log("\n=== Downloading merida ===");
    const source = SOURCES_TO_TRY[0];
    let ok = 0;
    for (const key of source.keys) {
        const result = await fetch(`${source.base}/${key}.svg`);
        if (result.status === 200) {
            fs.writeFileSync(path.join(dir, `${key}.svg`), result.data);
            const content = result.data.toString("utf8");
            console.log(`✓ ${key}.svg (${result.data.length}b)`);
            ok++;
        }
        await sleep(150);
    }
    console.log(`Done! ${ok}/12`);

    // Show fills from wK and bK
    const wK = fs.readFileSync(path.join(dir, "wK.svg"), "utf8");
    const bK = fs.readFileSync(path.join(dir, "bK.svg"), "utf8");
    console.log(
        "\nwK fills:",
        [...new Set(wK.match(/fill="[^"]+"/g) || [])].join(", "),
    );
    console.log(
        "bK fills:",
        [...new Set(bK.match(/fill="[^"]+"/g) || [])].join(", "),
    );
}

main().catch(console.error);
