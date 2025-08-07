const express = require('express');
const router = express.Router();
const { check, validationResult } = require('express-validator');
const Crypto = require('../models/Crypto');
const HistoricalCrypto = require('../models/HistoricalCrypto');
const auth = require('../middleware/auth');
const { fetchCryptoData } = require('../jobs/cryptoJob');

// In-memory cache for chart data
const cache = {};
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes in ms

router.get(
  '/',
  [
    auth,
    check('search').optional().isString().trim().escape(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array(), error: 'Invalid parameters' });
    }

    try {
      const search = req.query.search || '';
      const cacheKey = `crypto_list_${search}`;
      const cachedData = cache[cacheKey];

      if (cachedData && Date.now() - cachedData.timestamp < CACHE_DURATION) {
        console.log(`Using cached data for crypto list, search: ${search}`);
        return res.json({ data: cachedData.data });
      }

      const query = search
        ? {
            $or: [
              { name: { $regex: search, $options: 'i' } },
              { symbol: { $regex: search, $options: 'i' } },
            ],
          }
        : {};

      const cryptos = await Crypto.find(query)
        .select('coinId name symbol currentPrice marketCap priceChange24h lastUpdated')
        .sort({ marketCap: -1 })
        .limit(10)
        .lean();

      if (!cryptos.length && !search) {
        await fetchCryptoData();
        const newCryptos = await Crypto.find(query)
          .select('coinId name symbol currentPrice marketCap priceChange24h lastUpdated')
          .sort({ marketCap: -1 })
          .limit(10)
          .lean();
        cache[cacheKey] = { timestamp: Date.now(), data: newCryptos };
        return res.json({ data: newCryptos });
      }

      cache[cacheKey] = { timestamp: Date.now(), data: cryptos };
      res.json({ data: cryptos });
    } catch (error) {
      console.error('Error fetching cryptos:', error);
      res.status(500).json({ error: 'Failed to fetch crypto data' });
    }
  }
);

router.get(
  '/historical/:coinId',
  [auth, check('coinId').isAlphanumeric().trim().escape()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array(), error: 'Invalid coin ID' });
    }

    try {
      const historicalData = await HistoricalCrypto.find({ coinId: req.params.coinId })
        .select('open high low close volume timestamp')
        .sort({ timestamp: -1 })
        .limit(60)
        .lean();

      if (!historicalData.length) {
        return res.status(404).json({ error: 'No historical data found for this coin' });
      }

      res.json(historicalData);
    } catch (error) {
      console.error('Error fetching historical data:', error);
      res.status(500).json({ error: 'Failed to fetch historical data' });
    }
  }
);

router.get(
  '/chart/:coinId',
  [auth, check('coinId').isAlphanumeric().trim().escape()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array(), error: 'Invalid coin ID' });
    }

    try {
      const range = req.query.range === '3d' ? 3 : 1; // Default to 1 day
      const cacheKey = `${req.params.coinId}_chart_${range}d`;
      const cachedData = cache[cacheKey];

      // Check cache
      if (cachedData && Date.now() - cachedData.timestamp < CACHE_DURATION) {
        console.log(`Using cached chart data for ${req.params.coinId}, range: ${range}d`);
        return res.json(cachedData.data);
      }

      const daysAgo = new Date(Date.now() - range * 24 * 60 * 60 * 1000);

      const historicalData = await HistoricalCrypto.find({
        coinId: req.params.coinId,
        timestamp: { $gte: daysAgo },
      })
        .select('open high low close timestamp')
        .sort({ timestamp: 1 }) // Ascending for chart
        .lean();

      if (!historicalData.length) {
        return res.status(404).json({ error: 'No historical data found for this coin' });
      }

      const chartData = {
        labels: historicalData.map((d) => new Date(d.timestamp).toISOString()),
        datasets: [
          {
            label: `${req.params.coinId.toUpperCase()} Candlestick`,
            data: historicalData.map((d) => ({
              t: d.timestamp,
              o: d.open,
              h: d.high,
              l: d.low,
              c: d.close,
            })),
          },
        ],
      };

      // Cache the data
      cache[cacheKey] = {
        timestamp: Date.now(),
        data: chartData,
      };

      res.json(chartData);
    } catch (error) {
      console.error('Error fetching chart data:', error);
      res.status(500).json({ error: 'Failed to fetch chart data' });
    }
  }
);

module.exports = router;
