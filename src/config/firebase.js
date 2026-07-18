const admin = require('firebase-admin');

// Initialize Firebase Admin only when credentials are configured.
// On Render (production) the env vars are always set. On a local machine
// without the service-account key, skip init instead of crashing the whole
// server — only Google/Apple token verification needs Firebase Admin;
// jobs, products, orders and the admin panel all work without it.
if (!admin.apps.length) {
  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey  = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (projectId && clientEmail && privateKey) {
    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'main-app-prod.appspot.com',
    });
  } else {
    console.warn(
      '[firebase] Admin SDK NOT initialized — FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / ' +
      'FIREBASE_PRIVATE_KEY missing from .env. Google/Apple sign-in verification will fail; ' +
      'everything else works. (Expected on local dev machines.)'
    );
  }
}

module.exports = admin;
