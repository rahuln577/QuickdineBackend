const admin = require('firebase-admin');

async function initializeFirebase() {
  if (!admin.apps.length) {
    try {
      // Load service account (supports both file and env var)
      const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT 
        ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
        : require('/etc/secrets/serviceAccountKey.json');

      // Initialize with Realtime Database config
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://zomswig-c47e3-default-rtdb.firebaseio.com/'
      });

      console.log('Firebase Admin initialized successfully');
    } catch (error) {
      console.error('Firebase initialization error:', error);
      throw error;
    }
  }
  return admin;
}

// Test Realtime Database connection
async function testRTDBConnection(db) {
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
async function initializeFirebaseServices(maxRetries = 3) {
  let lastError;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      const adminInstance = await initializeFirebase();
      const db = adminInstance.database();
      const auth = adminInstance.auth(); // Get auth instance
      
      await testRTDBConnection(db);
      
      return { 
        admin: adminInstance,
        db,
        auth // Make sure auth is included
      };
    } catch (error) {
      lastError = error;
      console.warn(`Initialization attempt ${i + 1} failed. Retrying...`);
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  throw lastError;
}

// Singleton pattern with immediate initialization
let firebaseServices;

(async () => {
  try {
    firebaseServices = await initializeFirebaseServices();
    console.log('Firebase services initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Firebase services:', error);
    process.exit(1); // Fail fast if initialization fails
  }
})();

module.exports = {
  getAuth: () => {
    if (!firebaseServices) {
      throw new Error('Firebase services not initialized yet');
    }
    return firebaseServices.auth; // Proper auth instance with verifyIdToken
  },
  getDB: () => {
    if (!firebaseServices) {
      throw new Error('Firebase services not initialized yet');
    }
    return firebaseServices.db;
  },
  getAdmin: () => {
    if (!firebaseServices) {
      throw new Error('Firebase services not initialized yet');
    }
    return firebaseServices.admin;
  }
};