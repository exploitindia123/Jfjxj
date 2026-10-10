const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { db, admin } = require('../firebase-admin');
const router = express.Router();

// Register
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Create Firebase Auth user
    const userRecord = await admin.auth().createUser({
      email,
      password,
      emailVerified: false
    });

    // Hash password for our own record (backup)
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user profile in database
    await db.ref(`users/${userRecord.uid}`).set({
      email,
      passwordHash: hashedPassword,
      balance: 0,
      createdAt: admin.database.ServerValue.TIMESTAMP,
      role: 'user',
      totalWins: 0,
      totalBets: 0
    });

    // Generate JWT
    const token = jwt.sign(
      { uid: userRecord.uid, email: userRecord.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      success: true,
      token,
      user: { uid: userRecord.uid, email: userRecord.email, balance: 0 }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    // Verify with Firebase Auth
    let userRecord;
    try {
      userRecord = await admin.auth().getUserByEmail(email);
    } catch (err) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Get user data from DB
    const userSnapshot = await db.ref(`users/${userRecord.uid}`).once('value');
    const userData = userSnapshot.val();

    if (!userData) {
      return res.status(401).json({ error: 'User profile not found' });
    }

    // Verify password using bcrypt hash we stored
    const validPassword = await bcrypt.compare(password, userData.passwordHash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT
    const token = jwt.sign(
      { uid: userRecord.uid, email: userRecord.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      token,
      user: {
        uid: userRecord.uid,
        email: userRecord.email,
        balance: userData.balance || 0
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Verify token
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const userSnapshot = await db.ref(`users/${decoded.uid}`).once('value');
    const userData = userSnapshot.val();

    if (!userData) return res.status(404).json({ error: 'User not found' });

    res.json({
      uid: decoded.uid,
      email: userData.email,
      balance: userData.balance || 0,
      role: userData.role || 'user'
    });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router;
