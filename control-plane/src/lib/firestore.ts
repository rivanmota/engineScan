import { getApps, initializeApp, cert, App } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";

// Singleton Admin SDK app/client. Guards against Next.js hot-reload
// re-initializing the app (which would throw "already exists").
//
// When FIRESTORE_EMULATOR_HOST is set (see .env.local.example), the Admin
// SDK automatically routes all Firestore calls to the local emulator
// instead of real GCP — no code branching needed here.
declare global {
  // eslint-disable-next-line no-var
  var __firebaseApp: App | undefined;
}

function getFirebaseApp(): App {
  if (global.__firebaseApp) return global.__firebaseApp;

  const existing = getApps();
  if (existing.length > 0) {
    global.__firebaseApp = existing[0];
    return existing[0];
  }

  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  const usingEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;

  const app = usingEmulator
    ? initializeApp({ projectId })
    : initializeApp({ credential: cert(JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "{}")), projectId });

  global.__firebaseApp = app;
  return app;
}

let db: Firestore | undefined;

export function getDb(): Firestore {
  if (!db) {
    db = getFirestore(getFirebaseApp());
  }
  return db;
}
