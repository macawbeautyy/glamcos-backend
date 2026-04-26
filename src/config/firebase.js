/**
 * Firebase Admin SDK — initialised once at startup.
 *
 * Used for:
 *  - Firestore writes (real-time metrics, booking status sync)
 *  - FCM push notifications via Expo Push API
 *  - Firebase Storage signed-URL generation
 *
 * Requires env vars:
 *  FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 * (or place serviceAccountKey.json in this folder and switch to file import)
 */

const admin = require('firebase-admin');

if (!admin.apps.length) {
  const credential = process.env.FIREBASE_PRIVATE_KEY
    ? admin.credential.cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        // Env vars encode newlines as literal \n — restore them
        privateKey:  process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      })
    : admin.credential.applicationDefault(); // fallback for local dev with gcloud CLI

  admin.initializeApp({
    credential,
    storageBucket: `${process.env.FIREBASE_PROJECT_ID}.appspot.com`,
  });
}

const db      = admin.firestore();
const storage = admin.storage();
const fcm     = admin.messaging();

/**
 * Sync a document to Firestore (upsert / merge).
 * @param {string} collection
 * @param {string} docId
 * @param {object} data
 */
async function firestoreSet(collection, docId, data) {
  await db.collection(collection).doc(docId).set(
    { ...data, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
}

/**
 * Add a document to a Firestore collection (auto-ID).
 */
async function firestoreAdd(collection, data) {
  return db.collection(collection).add({
    ...data,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/**
 * Increment a numeric field in a Firestore document atomically.
 */
async function firestoreIncrement(collection, docId, field, by = 1) {
  await db.collection(collection).doc(docId).set(
    { [field]: admin.firestore.FieldValue.increment(by) },
    { merge: true }
  );
}

module.exports = {
  admin,
  db,
  storage,
  fcm,
  firestoreSet,
  firestoreAdd,
  firestoreIncrement,
};
