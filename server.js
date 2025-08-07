const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cryptoRoutes = require('./routes/crypto');
const { startCryptoJob } = require('./jobs/cryptoJob');
require('dotenv').config();

const app = express();

// Security Middleware
app.use(helmet());
const FRONTEND_URL = 'https://crypto-front-8l8t.onrender.com';
app.use(cors({ origin: FRONTEND_URL || 'https://crypto-front-8l8t.onrender.com' }));
app.use(express.json());

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many requests, please try again later.' }
});
app.use(limiter);

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error('Server Error:', err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Database connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    startCryptoJob();
  })
  .catch(err => {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  });

// Routes
app.use('/api/crypto', cryptoRoutes);
app.get('/', (req, res) => {
  res.send('Server is running');
})

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));