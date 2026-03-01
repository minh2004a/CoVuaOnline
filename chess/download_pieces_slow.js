const fs = require("fs");
const https = require("https");
const path = require("path");

const PIECE_IMGS = {
    wK: "https://upload.wikimedia.org/wikipedia/commons/4/42/Chess_klt45.svg",
    wQ: "https://upload.wikimedia.org/wikipedia/commons/1/15/Chess_qlt45.svg",
    wR: "https://upload.wikimedia.org/wikipedia/commons/7/72/Chess_rlt45.svg",
    wB: "https://upload.wikimedia.org/wikipedia/commons/b/b1/Chess_blt45.svg",
    wN: "https://upload.wikimedia.org/wikipedia/commons/7/70/Chess_nlt45.svg",
    wP: "https://upload.wikimedia.org/wikipedia/commons/4/45/Chess_plt45.svg",
    bK: "https://upload.wikimedia.org/wikipedia/commons/f/f0/Chess_kdt45.svg",
    bQ: "https://upload.wikimedia.org/wikipedia/commons/4/47/Chess_qdt45.svg",
    bR: "https://upload.wikimedia.org/wikipedia/commons/f/ff/Chess_rdt45.svg",
    bB: "https://upload.wikimedia.org/wikipedia/commons/9/98/Chess_bdt45.svg",
    bN: "https://upload.wikimedia.org/wikipedia/commons/e/ef/Chess_ndt45.svg",
    bP: "https://upload.wikimedia.org/wikipedia/commons/c/c7/Chess_pdt45.svg",
};

const dir = path.join(__dirname, "images");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function download() {
    for (const [key, urlString] of Object.entries(PIECE_IMGS)) {
        await new Promise((resolve, reject) => {
            const url = new URL(urlString);
            const options = {
                hostname: url.hostname,
                path: url.pathname,
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/114.0.0.0 Safari/537.36",
                },
            };
            https
                .get(options, (res) => {
                    let data = "";
                    res.on("data", (chunk) => (data += chunk));
                    res.on("end", () => {
                        if (data.includes("429")) {
                            console.error("Got 429 Too Many Requests for", key);
                            return resolve(false);
                        }
                        if (key.startsWith("b")) {
                            data = data.replace(
                                /fill="#000000"/g,
                                'fill="#333333"',
                            );
                            data = data.replace(
                                /fill:#000000/g,
                                "fill:#333333",
                            );
                            data = data.replace(
                                /stroke-width="1\.5"/g,
                                'stroke-width="0.8"',
                            );
                            data = data.replace(
                                /stroke-width:1\.5/g,
                                "stroke-width:0.8",
                            );
                        }
                        fs.writeFileSync(path.join(dir, `${key}.svg`), data);
                        console.log(`Downloaded and saved ${key}.svg`);
                        resolve(true);
                    });
                })
                .on("error", reject);
        });

        await sleep(1500); // 1.5 seconds delay
    }
}

download().catch(console.error);
