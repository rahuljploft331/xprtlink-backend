import { getSecretSync } from "../config/secrets.js";

let adminApp = null;

async function getFirebaseAdmin() {
  if (adminApp) return adminApp;

  const projectId = getSecretSync("FIREBASE_PROJECT_ID");
  if (!projectId) {
    throw new Error("FIREBASE_PROJECT_ID is not configured");
  }

  const { default: admin } = await import("firebase-admin");

  if (admin.apps.length === 0) {
    const credentialsJson = getSecretSync("FIREBASE_SERVICE_ACCOUNT_JSON");
    const credentialsPath = getSecretSync("FIREBASE_SERVICE_ACCOUNT_PATH");

    if (credentialsJson) {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(credentialsJson)),
        projectId,
      });
    } else if (credentialsPath) {
      const { readFileSync } = await import("node:fs");
      const serviceAccount = JSON.parse(readFileSync(credentialsPath, "utf8"));
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId,
      });
    } else {
      throw new Error(
        "Firebase credentials not configured (FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH)"
      );
    }
  }

  adminApp = admin;
  return adminApp;
}

/**
 * Verify a Firebase ID token from Google/Apple sign-in on the mobile client.
 * @returns {Promise<import('firebase-admin/auth').DecodedIdToken>}
 */
export async function verifyFirebaseIdToken(idToken) {
  const admin = await getFirebaseAdmin();
  return admin.auth().verifyIdToken(idToken);
}

export function isFirebaseConfigured() {
  return Boolean(getSecretSync("FIREBASE_PROJECT_ID"));
}
