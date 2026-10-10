const admin = require('firebase-admin');
require('dotenv').config();

// You need to download serviceAccountKey.json from Firebase Console:
// Project Settings > Service Accounts > Generate New Private Key
const serviceAccount = require('./serviceAccountKey.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
}

const db = admin.database();
const auth = admin.auth();

module.exports = { admin, db, auth };
