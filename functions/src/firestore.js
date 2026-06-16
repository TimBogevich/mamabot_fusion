/**
 * @fileoverview Firebase Admin SDK initialization and Firestore client singleton.
 *
 * Initializes the firebase-admin app with the project ID from environment or
 * the default 'mamabot-97d22'. Exports the Firestore `db` instance for use
 * by all collection helper modules.
 *
 * Usage:
 *   const { db } = require('./firestore');
 *   const snap = await db.collection('users').doc('12345').get();
 *
 * Prerequisites:
 *   - GOOGLE_APPLICATION_CREDENTIALS environment variable pointing to a
 *     service account key file, OR
 *   - Application Default Credentials configured via
 *     `gcloud auth application-default login`, OR
 *   - FIRESTORE_EMULATOR_HOST environment variable for local development
 */

const { getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'mamabot-97d22';

// ---------------------------------------------------------------------------
// Initialize Firebase Admin SDK
// ---------------------------------------------------------------------------

if (getApps().length === 0) {
  initializeApp({ projectId: PROJECT_ID });
  console.log(`[firestore] Firebase Admin SDK initialized (project: ${PROJECT_ID})`);
} else {
  console.log('[firestore] Firebase Admin SDK already initialized');
}

// ---------------------------------------------------------------------------
// Firestore client singleton
// ---------------------------------------------------------------------------

const db = getFirestore();

// If running against the Firestore emulator, configure the host
if (process.env.FIRESTORE_EMULATOR_HOST) {
  db.settings({
    host: process.env.FIRESTORE_EMULATOR_HOST,
    ssl: false,
  });
  console.log(`[firestore] Using emulator: ${process.env.FIRESTORE_EMULATOR_HOST}`);
}

module.exports = { db };