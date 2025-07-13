const { getAuth } = require('../config/firebase');

const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header missing or invalid' });
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    const auth = getAuth(); // Get the properly initialized auth instance
    const decodedToken = await auth.verifyIdToken(idToken);
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email || null,
      ...decodedToken
    };
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    
    let errorMessage = 'Authentication failed';
    if (error.code === 'auth/id-token-expired') {
      errorMessage = 'Token expired';
    } else if (error.code === 'auth/argument-error') {
      errorMessage = 'Invalid token format';
    }
    
    res.status(401).json({ 
      error: errorMessage,
      code: error.code || 'authentication_error'
    });
  }
};

module.exports = { authenticate };