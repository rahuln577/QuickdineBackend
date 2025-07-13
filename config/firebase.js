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
    } catch (error) {
      console.error('Firebase initialization error:', error);
      throw error;
    }
  }
  return admin;
}

// Test Realtime Database connection
async function testRealtimeDBConnection(db) {
  try {
    await db.ref('.info/connected').once('value');
    console.log('Realtime Database connection verified');
    return true;
  } catch (error) {
    console.error('Realtime Database connection test failed:', error);
    throw error;
  }
}

// Initialize with retry logic
async function getFirebaseWithRetry(maxRetries = 3) {
  let lastError;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      const adminInstance = initializeFirebase();
      const db = adminInstance.database(); // Use database() for Realtime DB
      await testRealtimeDBConnection(db);
      
      return { 
        admin: adminInstance, 
        db: db, 
        auth: adminInstance.auth() 
      };
    } catch (error) {
      lastError = error;
      console.warn(`Attempt ${i + 1} failed. Retrying...`);
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  throw lastError;
}

// Export initialized services
let firebaseServices;
const initPromise = getFirebaseWithRetry().then(services => {
  firebaseServices = services;
  return services;
});

module.exports = {
  getFirebase: () => firebaseServices || initPromise,
  admin: () => firebaseServices?.admin,
  db: () => firebaseServices?.db,
  auth: () => firebaseServices?.auth
};