require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const walletRoutes = require('./routes/wallet');
const gameRoutes = require('./routes/games');
const adminRoutes = require('./routes/admin');
const leaderboardRoutes = require('./routes/leaderboard');

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// Auth middleware
const { verifyToken } = require('./middleware/auth');

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/wallet', verifyToken, walletRoutes);
app.use('/api/games', verifyToken, gameRoutes);
app.use('/api/admin', verifyToken, adminRoutes);
app.use('/api/leaderboard', verifyToken, leaderboardRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!', message: err.message });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Environment: ${process.env.NODE_ENV}`);
});
