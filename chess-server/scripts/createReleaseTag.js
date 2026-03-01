const { execFileSync } = require("child_process");

function runGit(args) {
    return execFileSync("git", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    }).trim();
}

function pad2(value) {
    return String(value).padStart(2, "0");
}

function defaultTagName() {
    const now = new Date();
    return (
        `release-${now.getUTCFullYear()}` +
        `${pad2(now.getUTCMonth() + 1)}${pad2(now.getUTCDate())}` +
        `-${pad2(now.getUTCHours())}${pad2(now.getUTCMinutes())}`
    );
}

function usage() {
    console.log("Usage:");
    console.log("  npm run release:tag -- <tag-name>");
    console.log("Example:");
    console.log("  npm run release:tag -- release-20260301-1430");
}

function main() {
    const requestedTag = process.argv[2];
    if (requestedTag === "--help" || requestedTag === "-h") {
        usage();
        return;
    }

    const tag = requestedTag || defaultTagName();
    const status = runGit(["status", "--porcelain"]);
    if (status) {
        throw new Error(
            "Working tree is not clean. Commit your changes before creating a release tag.",
        );
    }

    const existingTag = runGit(["tag", "--list", tag]);
    if (existingTag === tag) {
        throw new Error(`Tag already exists: ${tag}`);
    }

    const commit = runGit(["rev-parse", "--short", "HEAD"]);
    const message = `Release ${tag}`;
    runGit(["tag", "-a", tag, "-m", message]);

    console.log(`[RELEASE] Created tag ${tag} at ${commit}`);
    console.log(`[RELEASE] Push: git push origin ${tag}`);
    console.log(`[ROLLBACK] Deploy tag commit: git checkout ${tag}`);
}

try {
    main();
} catch (error) {
    console.error("[RELEASE] ERROR:", error.message);
    process.exit(1);
}
