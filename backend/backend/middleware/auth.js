const jwt = require('jsonwebtoken');
const { db } = require('../firebase-admin');

async function verifyToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Verify user still exists
    const userSnapshot = await db.ref(`users/${decoded.uid}`).once('value');
    if (!userSnapshot.exists()) {
      return res.status(401).json({ error: 'User no longer exists' });
    }

    req.user = { uid: decoded.uid, email: decoded.email };
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token', details: error.message });
  }
}

function verifyAdmin(req, res, next) {
  if (req.user.email !== process.env.ADMIN_EMAIL) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { verifyToken, verifyAdmin };
