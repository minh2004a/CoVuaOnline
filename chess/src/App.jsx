import { useEffect, useMemo, useState } from "react";

const LEGACY_SHELL_URL = "/legacy/index.html";
const LEGACY_SCRIPT_CHAIN = [
    "https://cdn.socket.io/4.7.4/socket.io.min.js",
    "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js",
    "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js",
    "/legacy/sounds.js",
    "/legacy/pieces.js",
    "/legacy/online.js",
    "/legacy/chess.js",
];

function extractLegacyBodyHtml(htmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, "text/html");
    doc.querySelectorAll("script").forEach((node) => node.remove());
    return doc.body.innerHTML.trim();
}

function loadScriptSequentially(src) {
    return new Promise((resolve, reject) => {
        const selector = `script[data-legacy-src="${src}"]`;
        const existing = document.querySelector(selector);

        if (existing) {
            if (existing.dataset.loaded === "true") {
                resolve();
                return;
            }
            existing.addEventListener("load", () => resolve(), { once: true });
            existing.addEventListener(
                "error",
                () => reject(new Error(`Cannot load script: ${src}`)),
                { once: true },
            );
            return;
        }

        const script = document.createElement("script");
        script.src = src;
        script.async = false;
        script.defer = false;
        script.dataset.legacySrc = src;
        script.addEventListener(
            "load",
            () => {
                script.dataset.loaded = "true";
                resolve();
            },
            { once: true },
        );
        script.addEventListener(
            "error",
            () => reject(new Error(`Cannot load script: ${src}`)),
            { once: true },
        );
        document.body.appendChild(script);
    });
}

export default function App() {
    const [shellHtml, setShellHtml] = useState("");
    const [shellError, setShellError] = useState("");
    const [bootError, setBootError] = useState("");
    const [booting, setBooting] = useState(false);

    useEffect(() => {
        document.body.classList.add("arena-layout");

        return () => {
            document.body.classList.remove("arena-layout");
            document.body.classList.remove("has-mobile-action-bar");
        };
    }, []);

    useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                const response = await fetch(LEGACY_SHELL_URL, {
                    cache: "no-store",
                });
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const legacyPageHtml = await response.text();
                const legacyBodyHtml = extractLegacyBodyHtml(legacyPageHtml);

                if (!cancelled) {
                    setShellHtml(legacyBodyHtml);
                }
            } catch (error) {
                if (cancelled) return;
                setShellError(error instanceof Error ? error.message : String(error));
            }
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (!shellHtml || shellError) return;

        if (window.__CHESS_LEGACY_BOOTSTRAPPED__) {
            return;
        }

        let cancelled = false;
        setBooting(true);

        (async () => {
            try {
                for (const src of LEGACY_SCRIPT_CHAIN) {
                    if (cancelled) return;
                    await loadScriptSequentially(src);
                }

                if (cancelled) return;
                window.__CHESS_LEGACY_BOOTSTRAPPED__ = true;
                setBooting(false);
            } catch (error) {
                if (cancelled) return;
                setBootError(error instanceof Error ? error.message : String(error));
                setBooting(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [shellHtml, shellError]);

    const toast = useMemo(() => {
        if (shellError) return null;
        if (bootError) return `Legacy bootstrap failed: ${bootError}`;
        if (booting) return "Loading chess engine...";
        if (!shellHtml) return "Loading legacy layout...";
        return null;
    }, [bootError, booting, shellError, shellHtml]);

    if (shellError) {
        return (
            <div className="flex min-h-screen w-full items-center justify-center bg-slate-950 px-6 text-slate-100">
                <div className="max-w-2xl rounded-lg border border-rose-500/40 bg-slate-900/95 p-6 text-sm leading-6">
                    <p className="font-semibold text-rose-300">Cannot load legacy UI shell.</p>
                    <p className="mt-2 text-slate-300">{shellError}</p>
                </div>
            </div>
        );
    }

    return (
        <>
            {toast ? (
                <div className="fixed left-1/2 top-4 z-[12000] -translate-x-1/2 rounded-md border border-slate-700 bg-slate-950/95 px-4 py-2 text-sm text-slate-200 shadow-lg">
                    {toast}
                </div>
            ) : null}
            <div dangerouslySetInnerHTML={{ __html: shellHtml }} />
        </>
    );
}