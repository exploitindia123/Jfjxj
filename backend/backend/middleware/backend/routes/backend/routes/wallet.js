const express = require('express');
const { db, admin } = require('../firebase-admin');
const router = express.Router();

// Get balance
router.get('/balance', async (req, res) => {
  try {
    const snapshot = await db.ref(`users/${req.user.uid}/balance`).once('value');
    res.json({ balance: snapshot.val() || 0 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get transaction history
router.get('/transactions', async (req, res) => {
  try {
    const snapshot = await db.ref(`users/${req.user.uid}/transactions`)
      .orderByChild('timestamp')
      .limitToLast(50)
      .once('value');

    const transactions = [];
    snapshot.forEach(child => transactions.push({ id: child.key, ...child.val() }));
    transactions.reverse();

    res.json({ transactions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Submit deposit request
router.post('/deposit', async (req, res) => {
  try {
    const { amount, utr } = req.body;

    if (!amount || amount < 100) {
      return res.status(400).json({ error: 'Minimum deposit is ₹100' });
    }

    if (!utr || utr.length !== 12) {
      return res.status(400).json({ error: 'Valid 12-digit UTR required' });
    }

    // Check if UTR already used
    const existingSnapshot = await db.ref('deposit_requests')
      .orderByChild('utr')
      .equalTo(utr)
      .once('value');

    if (existingSnapshot.exists()) {
      return res.status(400).json({ error: 'This UTR has already been submitted' });
    }

    const requestRef = db.ref(`deposit_requests/${req.user.uid}`).push();
    await requestRef.set({
      amount,
      utr,
      status: 'pending',
      timestamp: admin.database.ServerValue.TIMESTAMP,
      userEmail: req.user.email,
      userId: req.user.uid
    });

    res.json({ success: true, requestId: requestRef.key });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Submit withdrawal request
router.post('/withdraw', async (req, res) => {
  try {
    const { upiNumber, amount } = req.body;

    if (!upiNumber || !upiNumber.includes('@')) {
      return res.status(400).json({ error: 'Valid UPI ID required' });
    }

    if (!amount || amount < 100) {
      return res.status(400).json({ error: 'Minimum withdrawal is ₹100' });
    }

    // Atomically deduct balance
    const userRef = db.ref(`users/${req.user.uid}/balance`);
    const { committed, snapshot } = await userRef.transaction(current => {
      if ((current || 0) < amount) return; // abort
      return (current || 0) - amount;
    });

    if (!committed) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    // Create withdrawal request
    await db.ref(`withdraw_requests/${req.user.uid}`).push().set({
      upiNumber,
      amount,
      status: 'pending',
      timestamp: admin.database.ServerValue.TIMESTAMP,
      userEmail: req.user.email,
      userId: req.user.uid
    });

    // Log transaction
    await db.ref(`users/${req.user.uid}/transactions`).push().set({
      description: 'Withdrawal Request',
      amount: -amount,
      date: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      timestamp: admin.database.ServerValue.TIMESTAMP
    });

    res.json({ success: true, newBalance: snapshot.val() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
