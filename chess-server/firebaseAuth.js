const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

let authReady = null;
let authInitError = null;

function normalizePrivateKey(value) {
    if (!value) return null;
    return value.replace(/\\n/g, "\n");
}

function resolveServiceAccount() {
    const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (rawJson) {
        return JSON.parse(rawJson);
    }

    const accountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    if (accountPath) {
        const fullPath = path.isAbsolute(accountPath)
            ? accountPath
            : path.join(process.cwd(), accountPath);
        if (fs.existsSync(fullPath)) {
            return JSON.parse(fs.readFileSync(fullPath, "utf8"));
        }
    }

    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

    if (projectId && clientEmail && privateKey) {
        return {
            project_id: projectId,
            client_email: clientEmail,
            private_key: privateKey,
        };
    }

    return null;
}

function ensureFirebaseAdmin() {
    if (authReady !== null) return authReady;

    try {
        if (admin.apps.length === 0) {
            const serviceAccount = resolveServiceAccount();
            if (serviceAccount) {
                admin.initializeApp({
                    credential: admin.credential.cert(serviceAccount),
                });
            } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
                admin.initializeApp({
                    credential: admin.credential.applicationDefault(),
                });
            } else {
                throw new Error(
                    "Firebase Admin credentials are not configured.",
                );
            }
        }
        authReady = true;
    } catch (error) {
        authReady = false;
        authInitError = error;
    }

    return authReady;
}

function isAuthReady() {
    return ensureFirebaseAdmin();
}

function getAuthInitError() {
    return authInitError;
}

async function verifyGoogleIdToken(idToken) {
    if (!ensureFirebaseAdmin()) {
        throw new Error(
            "Google authentication is not configured on the server.",
        );
    }
    if (!idToken || typeof idToken !== "string") {
        throw new Error("Missing Firebase ID token.");
    }
    return admin.auth().verifyIdToken(idToken, true);
}

function getClientFirebaseConfig() {
    const config = {
        apiKey: process.env.FIREBASE_WEB_API_KEY || "",
        authDomain: process.env.FIREBASE_WEB_AUTH_DOMAIN || "",
        projectId: process.env.FIREBASE_WEB_PROJECT_ID || "",
        appId: process.env.FIREBASE_WEB_APP_ID || "",
        messagingSenderId:
            process.env.FIREBASE_WEB_MESSAGING_SENDER_ID || undefined,
        measurementId: process.env.FIREBASE_WEB_MEASUREMENT_ID || undefined,
    };

    const enabled =
        Boolean(config.apiKey) &&
        Boolean(config.authDomain) &&
        Boolean(config.projectId) &&
        Boolean(config.appId) &&
        isAuthReady();

    return {
        enabled,
        config: enabled ? config : null,
    };
}

module.exports = {
    isAuthReady,
    getAuthInitError,
    verifyGoogleIdToken,
    getClientFirebaseConfig,
};
