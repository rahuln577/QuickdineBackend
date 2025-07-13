const admin = require('firebase-admin');
const serviceAccount = require('/etc/secrets/serviceAccountKey.json');


function initializeFirebase() {
  if (!admin.apps.length) {
    try {

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://zomswig-c47e3-default-rtdb.firebaseio.com/'
      });

      console.log('Firebase Admin initialized successfully for Realtime Database');
      return admin;
    } catch (error) {
      console.error('Firebase initialization error:', error);
      throw error;
    }
  }
  return admin;
}

// Connection test function
async function testFirestoreConnection(db) {
  try {
    await db.listCollections(); // Simple operation to test connection
    console.log('Firestore connection verified');
    return true;
  } catch (error) {
    console.error('Firestore connection test failed:', error);
    throw error;
  }
}

// Initialize with retry logic
async function getFirebaseWithRetry(maxRetries = 3) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const admin = initializeFirebase();
      const db = admin.firestore();
      await testFirestoreConnection(db);
      return { admin, db, auth: admin.auth() };
    } catch (error) {
      lastError = error;
      console.warn(`Attempt ${i + 1} failed. Retrying...`);
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  throw lastError;
}

module.exports = getFirebaseWithRetry();