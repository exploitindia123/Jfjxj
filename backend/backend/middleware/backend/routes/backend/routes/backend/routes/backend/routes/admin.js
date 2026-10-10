const express = require('express');
const { db, admin } = require('../firebase-admin');
const { verifyAdmin } = require('../middleware/auth');
const router = express.Router();

// All admin routes require admin
router.use(verifyAdmin);

// ============== DEPOSITS ==============
router.get('/deposits/pending', async (req, res) => {
  try {
    const snapshot = await db.ref('deposit_requests').once('value');
    const requests = [];

    snapshot.forEach(userSnap => {
      userSnap.forEach(reqSnap => {
        const req = reqSnap.val();
        if (req.status === 'pending') {
          requests.push({ id: reqSnap.key, userId: userSnap.key, ...req });
        }
      });
    });

    res.json({ requests });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/deposits/:userId/:requestId/approve', async (req, res) => {
  try {
    const { userId, requestId } = req.params;

    const reqRef = db.ref(`deposit_requests/${userId}/${requestId}`);
    const reqSnapshot = await reqRef.once('value');
    const request = reqSnapshot.val();

    if (!request || request.status !== 'pending') {
      return res.status(400).json({ error: 'Invalid or already processed request' });
    }

    // Add balance
    const userRef = db.ref(`users/${userId}/balance`);
    const { snapshot } = await userRef.transaction(current => (current || 0) + request.amount);

    // Update request status
    await reqRef.update({ status: 'approved', approvedAt: admin.database.ServerValue.TIMESTAMP });

    // Log transaction
    await db.ref(`users/${userId}/transactions`).push({
      description: 'Deposit Approved',
      amount: request.amount,
      date: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      timestamp: admin.database.ServerValue.TIMESTAMP
    });

    res.json({ success: true, newBalance: snapshot.val() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/deposits/:userId/:requestId/reject', async (req, res) => {
  try {
    const { userId, requestId } = req.params;
    await db.ref(`deposit_requests/${userId}/${requestId}`).update({
      status: 'rejected',
      rejectedAt: admin.database.ServerValue.TIMESTAMP
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============== WITHDRAWALS ==============
router.get('/withdrawals/pending', async (req, res) => {
  try {
    const snapshot = await db.ref('withdraw_requests').once('value');
    const requests = [];

    snapshot.forEach(userSnap => {
      userSnap.forEach(reqSnap => {
        const req = reqSnap.val();
        if (req.status === 'pending') {
          requests.push({ id: reqSnap.key, userId: userSnap.key, ...req });
        }
      });
    });

    res.json({ requests });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/withdrawals/:userId/:requestId/mark-paid', async (req, res) => {
  try {
    const { userId, requestId } = req.params;
    await db.ref(`withdraw_requests/${userId}/${requestId}`).update({
      status: 'paid',
      paidAt: admin.database.ServerValue.TIMESTAMP
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/withdrawals/:userId/:requestId/reject', async (req, res) => {
  try {
    const { userId, requestId } = req.params;

    const reqRef = db.ref(`withdraw_requests/${userId}/${requestId}`);
    const reqSnapshot = await reqRef.once('value');
    const request = reqSnapshot.val();

    if (!request || request.status !== 'pending') {
      return res.status(400).json({ error: 'Invalid or already processed request' });
    }

    // Refund balance
    await db.ref(`users/${userId}/balance`).transaction(current => (current || 0) + request.amount);

    await reqRef.update({ status: 'rejected', rejectedAt: admin.database.ServerValue.TIMESTAMP });

    // Log transaction
    await db.ref(`users/${userId}/transactions`).push({
      description: 'Withdrawal Rejected - Refund',
      amount: request.amount,
      date: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      timestamp: admin.database.ServerValue.TIMESTAMP
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============== GAME CONTROL ==============
router.post('/game-control/ct-result', async (req, res) => {
  try {
    const { nextNumber } = req.body;
    if (nextNumber < 0 || nextNumber > 9) {
      return res.status(400).json({ error: 'Number must be 0-9' });
    }
    await db.ref('admin_controls/color_trading/next_result').set(nextNumber);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/game-control/hotline-result', async (req, res) => {
  try {
    const { symbols } = req.body;
    if (!Array.isArray(symbols) || symbols.length !== 3) {
      return res.status(400).json({ error: 'Provide array of 3 symbols' });
    }
    await db.ref('admin_controls/hotline/next_result').set(symbols);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/game-control/balloon-pop', async (req, res) => {
  try {
    const { multiplier } = req.body;
    if (multiplier <= 1) {
      return res.status(400).json({ error: 'Multiplier must be > 1' });
    }
    await db.ref('admin_controls/balloon/next_pop_multiplier').set(multiplier);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/game-control/keno-result', async (req, res) => {
  try {
    const { numbers } = req.body;
    if (!Array.isArray(numbers) || numbers.length !== 10) {
      return res.status(400).json({ error: 'Provide array of 10 numbers' });
    }
    await db.ref('admin_controls/keno/next_drawn_numbers').set(numbers);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============== PROMOTIONS ==============
router.post('/promotions', async (req, res) => {
  try {
    const { bannerUrl, linkUrl } = req.body;
    if (!bannerUrl || !linkUrl) {
      return res.status(400).json({ error: 'bannerUrl and linkUrl required' });
    }
    const ref = db.ref('admin_controls/promotions').push();
    await ref.set({ bannerUrl, linkUrl, createdAt: admin.database.ServerValue.TIMESTAMP });
    res.json({ success: true, id: ref.key });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/promotions/:id', async (req, res) => {
  try {
    await db.ref(`admin_controls/promotions/${req.params.id}`).remove();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============== USER MANAGEMENT ==============
router.get('/users', async (req, res) => {
  try {
    const snapshot = await db.ref('users').once('value');
    const users = [];
    snapshot.forEach(child => {
      const user = child.val();
      users.push({
        uid: child.key,
        email: user.email,
        balance: user.balance || 0,
        createdAt: user.createdAt
      });
    });
    res.json({ users });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/users/:uid/balance', async (req, res) => {
  try {
    const { amount, reason } = req.body;
    if (!amount || !reason) {
      return res.status(400).json({ error: 'amount and reason required' });
    }

    const userRef = db.ref(`users/${req.params.uid}/balance`);
    const { snapshot } = await userRef.transaction(current => (current || 0) + amount);

    await db.ref(`users/${req.params.uid}/transactions`).push({
      description: `Admin: ${reason}`,
      amount,
      date: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      timestamp: admin.database.ServerValue.TIMESTAMP
    });

    res.json({ success: true, newBalance: snapshot.val() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/users/:uid/ban', async (req, res) => {
  try {
    await db.ref(`users/${req.params.uid}/banned`).set(true);
    await admin.auth().updateUser(req.params.uid, { disabled: true });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/users/:uid/unban', async (req, res) => {
  try {
    await db.ref(`users/${req.params.uid}/banned`).remove();
    await admin.auth().updateUser(req.params.uid, { disabled: false });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
