const express = require('express');
const { db, admin } = require('../firebase-admin');
const router = express.Router();

// ============== COLOR TRADING ==============
const CT_COLOR_MAP = {
  0: 'rv', 1: 'g', 2: 'r', 3: 'g', 4: 'r',
  5: 'gv', 6: 'r', 7: 'g', 8: 'r', 9: 'g'
};

function getCtColors(num) {
  return CT_COLOR_MAP[num].split('').map(c =>
    c === 'g' ? 'Green' : c === 'r' ? 'Red' : 'Violet'
  );
}

// Place CT bet
router.post('/ct/bet', async (req, res) => {
  try {
    const { period, type, value, amount } = req.body;

    if (!period || !type || value === undefined || !amount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

    // Check if period is closed
    const currentPeriod = getCurrentCtPeriod();
    if (period !== currentPeriod) {
      return res.status(400).json({ error: 'Betting period has ended' });
    }

    // Deduct balance atomically
    const userRef = db.ref(`users/${req.user.uid}/balance`);
    const { committed, snapshot } = await userRef.transaction(current => {
      if ((current || 0) < amount) return;
      return (current || 0) - amount;
    });

    if (!committed) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    // Save bet
    const betRef = db.ref(`users/${req.user.uid}/my_ct_history`).push();
    await betRef.set({
      period, type, value, amount,
      result: 'waiting',
      timestamp: admin.database.ServerValue.TIMESTAMP
    });

    // Add to all bets
    await db.ref('all_ct_bets').push({
      email: req.user.email,
      selection: value,
      amount,
      period,
      timestamp: admin.database.ServerValue.TIMESTAMP
    });

    // Log transaction
    await db.ref(`users/${req.user.uid}/transactions`).push({
      description: `CT Bet: ${value}`,
      amount: -amount,
      date: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      timestamp: admin.database.ServerValue.TIMESTAMP
    });

    res.json({ success: true, betId: betRef.key, newBalance: snapshot.val() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get current CT period info
router.get('/ct/current-period', async (req, res) => {
  try {
    const period = getCurrentCtPeriod();
    const now = new Date();
    const secondsLeft = 60 - now.getSeconds();

    res.json({ period, secondsLeft, periodDuration: 60 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get CT game history
router.get('/ct/history', async (req, res) => {
  try {
    const snapshot = await db.ref('ct_game_history')
      .orderByKey()
      .limitToLast(20)
      .once('value');

    const history = [];
    snapshot.forEach(child => history.push(child.val()));
    history.reverse();

    res.json({ history });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user's CT bet history
router.get('/ct/my-history', async (req, res) => {
  try {
    const snapshot = await db.ref(`users/${req.user.uid}/my_ct_history`)
      .orderByChild('timestamp')
      .limitToLast(50)
      .once('value');

    const history = [];
    snapshot.forEach(child => history.push({ id: child.key, ...child.val() }));
    history.reverse();

    res.json({ history });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============== MINES ==============
function calculateMinesMultiplier(gemsRevealed, mineCount) {
  if (gemsRevealed === 0) return 1;
  let multiplier = 1;
  for (let i = 0; i < gemsRevealed; i++) {
    multiplier *= (25 - mineCount - i) / (25 - i);
  }
  return 0.95 / multiplier;
}

// Start mines game
router.post('/mines/start', async (req, res) => {
  try {
    const { betAmount, mineCount } = req.body;

    if (betAmount <= 0 || mineCount < 1 || mineCount > 20) {
      return res.status(400).json({ error: 'Invalid parameters' });
    }

    // Check if user has active game
    const activeGameSnapshot = await db.ref(`users/${req.user.uid}/mines_active`).once('value');
    if (activeGameSnapshot.exists()) {
      return res.status(400).json({ error: 'You have an active game. Cashout first.' });
    }

    // Deduct balance
    const userRef = db.ref(`users/${req.user.uid}/balance`);
    const { committed, snapshot } = await userRef.transaction(current => {
      if ((current || 0) < betAmount) return;
      return (current || 0) - betAmount;
    });

    if (!committed) return res.status(400).json({ error: 'Insufficient balance' });

    // Generate mine positions (server-side only!)
    const minePositions = new Set();
    while (minePositions.size < mineCount) {
      minePositions.add(Math.floor(Math.random() * 25));
    }

    // Save game state
    const gameRef = db.ref(`users/${req.user.uid}/mines_active`);
    await gameRef.set({
      betAmount,
      mineCount,
      minePositions: Array.from(minePositions),
      revealedTiles: [],
      gemsFound: 0,
      multiplier: 1,
      startedAt: admin.database.ServerValue.TIMESTAMP
    });

    // Log transaction
    await db.ref(`users/${req.user.uid}/transactions`).push({
      description: 'Mines Bet',
      amount: -betAmount,
      date: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      timestamp: admin.database.ServerValue.TIMESTAMP
    });

    res.json({ success: true, newBalance: snapshot.val() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reveal a tile
router.post('/mines/reveal', async (req, res) => {
  try {
    const { tileIndex } = req.body;

    if (tileIndex < 0 || tileIndex > 24) {
      return res.status(400).json({ error: 'Invalid tile' });
    }

    const gameRef = db.ref(`users/${req.user.uid}/mines_active`);
    const gameSnapshot = await gameRef.once('value');
    const game = gameSnapshot.val();

    if (!game) return res.status(400).json({ error: 'No active game' });

    if (game.revealedTiles.includes(tileIndex)) {
      return res.status(400).json({ error: 'Tile already revealed' });
    }

    const isMine = game.minePositions.includes(tileIndex);
    let updatedGame;

    if (isMine) {
      // Game over - reveal all mines
      updatedGame = null;
      await gameRef.remove();

      res.json({
        hitMine: true,
        minePositions: game.minePositions,
        amountLost: game.betAmount
      });
    } else {
      // Gem found
      const newRevealed = [...game.revealedTiles, tileIndex];
      const newGemsFound = game.gemsFound + 1;
      const newMultiplier = calculateMinesMultiplier(newGemsFound, game.mineCount);

      updatedGame = {
        ...game,
        revealedTiles: newRevealed,
        gemsFound: newGemsFound,
        multiplier: newMultiplier
      };

      await gameRef.update(updatedGame);

      res.json({
        hitMine: false,
        tileIndex,
        gemsFound: newGemsFound,
        multiplier: newMultiplier,
        nextMultiplier: calculateMinesMultiplier(newGemsFound + 1, game.mineCount),
        currentProfit: game.betAmount * newMultiplier
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cashout
router.post('/mines/cashout', async (req, res) => {
  try {
    const gameRef = db.ref(`users/${req.user.uid}/mines_active`);
    const gameSnapshot = await gameRef.once('value');
    const game = gameSnapshot.val();

    if (!game) return res.status(400).json({ error: 'No active game' });

    if (game.gemsFound === 0) {
      return res.status(400).json({ error: 'Reveal at least one gem before cashing out' });
    }

    const winnings = game.betAmount * game.multiplier;
    const profit = winnings - game.betAmount;

    // Add winnings
    const userRef = db.ref(`users/${req.user.uid}/balance`);
    const { committed, snapshot } = await userRef.transaction(current => {
      return (current || 0) + winnings;
    });

    await gameRef.remove();

    // Log transaction
    await db.ref(`users/${req.user.uid}/transactions`).push({
      description: 'Mines Cashout',
      amount: winnings,
      date: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      timestamp: admin.database.ServerValue.TIMESTAMP
    });

    res.json({
      success: true,
      winnings,
      profit,
      newBalance: snapshot.val()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get active game state
router.get('/mines/active', async (req, res) => {
  try {
    const snapshot = await db.ref(`users/${req.user.uid}/mines_active`).once('value');
    const game = snapshot.val();

    if (!game) return res.json({ active: false });

    // Don't send mine positions to client!
    res.json({
      active: true,
      betAmount: game.betAmount,
      mineCount: game.mineCount,
      revealedTiles: game.revealedTiles,
      gemsFound: game.gemsFound,
      multiplier: game.multiplier
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============== HOTLINE SLOTS ==============
const HOTLINE_SYMBOLS = ['lemon', 'cherry', 'diamond', 'seven'];
const HOTLINE_PAYOUTS = { lemon: 5, cherry: 10, diamond: 25, seven: 100 };

router.post('/hotline/spin', async (req, res) => {
  try {
    const { betAmount } = req.body;

    if (betAmount <= 0) return res.status(400).json({ error: 'Invalid bet' });

    // Deduct balance
    const userRef = db.ref(`users/${req.user.uid}/balance`);
    const { committed, snapshot } = await userRef.transaction(current => {
      if ((current || 0) < betAmount) return;
      return (current || 0) - betAmount;
    });

    if (!committed) return res.status(400).json({ error: 'Insufficient balance' });

    // Check for admin-controlled result
    const adminResultRef = db.ref('admin_controls/hotline/next_result');
    const adminSnapshot = await adminResultRef.once('value');

    let result;
    if (adminSnapshot.exists() && Array.isArray(adminSnapshot.val()) && adminSnapshot.val().length === 3) {
      result = adminSnapshot.val();
      await adminResultRef.remove();
    } else {
      result = [
        HOTLINE_SYMBOLS[Math.floor(Math.random() * HOTLINE_SYMBOLS.length)],
        HOTLINE_SYMBOLS[Math.floor(Math.random() * HOTLINE_SYMBOLS.length)],
        HOTLINE_SYMBOLS[Math.floor(Math.random() * HOTLINE_SYMBOLS.length)]
      ];
    }

    // Check win
    const isWin = result.every(s => s === result[0]);
    let winnings = 0;

    if (isWin) {
      winnings = betAmount * HOTLINE_PAYOUTS[result[0]];
      await userRef.transaction(current => (current || 0) + winnings);
    }

    // Log transaction
    await db.ref(`users/${req.user.uid}/transactions`).push({
      description: isWin ? `Hotline Win (${result[0]})` : 'Hotline Bet',
      amount: isWin ? winnings : -betAmount,
      date: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      timestamp: admin.database.ServerValue.TIMESTAMP
    });

    // Get updated balance
    const finalSnapshot = await userRef.once('value');

    res.json({
      success: true,
      result,
      isWin,
      winnings,
      profit: isWin ? winnings - betAmount : -betAmount,
      newBalance: finalSnapshot.val()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============== BALLOON ==============
router.post('/balloon/start', async (req, res) => {
  try {
    const { betAmount } = req.body;

    if (betAmount <= 0) return res.status(400).json({ error: 'Invalid bet' });

    const userRef = db.ref(`users/${req.user.uid}/balance`);
    const { committed } = await userRef.transaction(current => {
      if ((current || 0) < betAmount) return;
      return (current || 0) - betAmount;
    });

    if (!committed) return res.status(400).json({ error: 'Insufficient balance' });

    // Check for admin-controlled pop multiplier
    const adminResultRef = db.ref('admin_controls/balloon/next_pop_multiplier');
    const adminSnapshot = await adminResultRef.once('value');

    let popMultiplier;
    if (adminSnapshot.exists()) {
      popMultiplier = parseFloat(adminSnapshot.val());
      await adminResultRef.remove();
    } else {
      // Random pop between 1.05x and 11x
      popMultiplier = 1.05 + Math.random() * 10;
    }

    // Save active game
    await db.ref(`users/${req.user.uid}/balloon_active`).set({
      betAmount,
      popMultiplier,
      startedAt: admin.database.ServerValue.TIMESTAMP
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/balloon/cashout', async (req, res) => {
  try {
    const { multiplier } = req.body;

    const gameRef = db.ref(`users/${req.user.uid}/balloon_active`);
    const gameSnapshot = await gameRef.once('value');
    const game = gameSnapshot.val();

    if (!game) return res.status(400).json({ error: 'No active balloon game' });

    if (multiplier >= game.popMultiplier) {
      await gameRef.remove();
      return res.json({ success: false, popped: true, popMultiplier: game.popMultiplier });
    }

    const winnings = game.betAmount * multiplier;
    const profit = winnings - game.betAmount;

    const userRef = db.ref(`users/${req.user.uid}/balance`);
    const { snapshot } = await userRef.transaction(current => (current || 0) + winnings);

    await gameRef.remove();

    await db.ref(`users/${req.user.uid}/transactions`).push({
      description: `Balloon Cashout (${multiplier.toFixed(2)}x)`,
      amount: winnings,
      date: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      timestamp: admin.database.ServerValue.TIMESTAMP
    });

    res.json({ success: true, winnings, profit, newBalance: snapshot.val() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============== KENO ==============
const KENO_PAYOUTS = { 0: 0, 1: 0, 2: 0.5, 3: 1, 4: 2, 5: 5, 6: 10, 7: 20, 8: 50, 9: 100, 10: 200 };

router.post('/keno/draw', async (req, res) => {
  try {
    const { selectedNumbers, betAmount } = req.body;

    if (!Array.isArray(selectedNumbers) || selectedNumbers.length === 0) {
      return res.status(400).json({ error: 'Select at least one number' });
    }

    if (selectedNumbers.length > 10) {
      return res.status(400).json({ error: 'Maximum 10 numbers' });
    }

    if (betAmount <= 0) return res.status(400).json({ error: 'Invalid bet' });

    const userRef = db.ref(`users/${req.user.uid}/balance`);
    const { committed, snapshot } = await userRef.transaction(current => {
      if ((current || 0) < betAmount) return;
      return (current || 0) - betAmount;
    });

    if (!committed) return res.status(400).json({ error: 'Insufficient balance' });

    // Generate drawn numbers (server-side)
    const drawnSet = new Set();
    while (drawnSet.size < 10) {
      drawnSet.add(Math.floor(Math.random() * 40) + 1);
    }
    const drawnNumbers = Array.from(drawnSet);

    // Calculate matches
    const matches = selectedNumbers.filter(n => drawnSet.has(n)).length;
    const multiplier = KENO_PAYOUTS[matches] || 0;
    const winnings = betAmount * multiplier;

    if (winnings > 0) {
      await userRef.transaction(current => (current || 0) + winnings);
    }

    await db.ref(`users/${req.user.uid}/transactions`).push({
      description: winnings > 0 ? `Keno Win (${matches} matches)` : 'Keno Bet',
      amount: winnings > 0 ? winnings : -betAmount,
      date: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      timestamp: admin.database.ServerValue.TIMESTAMP
    });

    const finalSnapshot = await userRef.once('value');

    res.json({
      success: true,
      drawnNumbers,
      matches,
      multiplier,
      winnings,
      profit: winnings - betAmount,
      newBalance: finalSnapshot.val()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper to get current CT period
function getCurrentCtPeriod() {
  const d = new Date();
  return `${d.getFullYear()}${(d.getMonth() + 1).toString().padStart(2, '0')}${d.getDate().toString().padStart(2, '0')}${String(Math.floor(d.getUTCHours() * 60 + d.getUTCMinutes())).padStart(4, '0')}`;
}

module.exports = router;
