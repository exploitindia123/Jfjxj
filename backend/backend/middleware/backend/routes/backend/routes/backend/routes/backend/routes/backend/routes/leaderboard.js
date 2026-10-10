const express = require('express');
const { db } = require('../firebase-admin');
const router = express.Router();

router.get('/top', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;

    const snapshot = await db.ref('users')
      .orderByChild('balance')
      .limitToLast(limit)
      .once('value');

    const players = [];
    snapshot.forEach(child => {
      const user = child.val();
      if (user.balance > 0) {
        players.unshift({
          uid: child.key,
          email: user.email ? user.email.replace(/^(...).*?(@.*)$/, '$1***$2') : 'Anonymous',
          balance: user.balance
        });
      }
    });

    res.json({ players });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
