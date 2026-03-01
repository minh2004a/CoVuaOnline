const { backupDatabaseOnce } = require("./dbBackup");

async function main() {
    try {
        const backupPath = await backupDatabaseOnce();
        console.log(`[BACKUP] OK: ${backupPath}`);
    } catch (error) {
        console.error("[BACKUP] ERROR:", error.message);
        process.exit(1);
    }
}

main();
