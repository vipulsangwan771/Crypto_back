const cron = require('node-cron');
const axios = require('axios');
const Crypto = require('../models/Crypto');
const HistoricalCrypto = require('../models/HistoricalCrypto');

const cache = {};
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour
let isJobRunning = false; // Lock to prevent overlapping jobs

const fetchCryptoData = async (retries = 3, baseDelay = 120000, days = 1, batchSize = 5, batchDelay = 5 * 60 * 1000) => {
  let lastError = null;
  let apiCallCount = 0;

  // Fetch top 10 coins in two batches
  const fetchBatch = async (page, perPage) => {
    try {
      console.log(`Fetching market data for batch (page ${page})...`);
      const marketResponse = await axios.get(
        'https://api.coingecko.com/api/v3/coins/markets',
        {
          params: {
            vs_currency: 'usd',
            order: 'market_cap_desc',
            per_page: perPage,
            page,
            sparkline: false,
            price_change_percentage: '24h',
          },
          timeout: 10000,
        }
      );
      apiCallCount++;
      console.log(`Market data fetched for batch (page ${page}, API call #${apiCallCount})`);
      console.log('Rate limit headers:', marketResponse.headers);

      const cryptoData = marketResponse.data.map((coin) => ({
        coinId: coin.id ?? 'unknown',
        name: coin.name ?? 'Unknown',
        symbol: coin.symbol ?? 'UNK',
        currentPrice: coin.current_price ?? 0,
        marketCap: coin.market_cap ?? 0,
        priceChange24h: coin.price_change_percentage_24h ?? 0,
        lastUpdated: new Date(coin.last_updated || Date.now()),
      }));

      const historicalPromises = cryptoData.map(async (crypto, index) => {
        const cacheKey = `${crypto.coinId}_ohlc_${days}d`;
        const cachedData = cache[cacheKey];

        if (cachedData && Date.now() - cachedData.timestamp < CACHE_DURATION) {
          console.log(`Using cached data for ${crypto.coinId}`);
          return cachedData.data;
        }

        await new Promise((resolve) => setTimeout(resolve, index * 12000)); // 12-second delay
        console.log(`Fetching OHLC for ${crypto.coinId} (API call #${apiCallCount + 1})`);
        const ohlcResponse = await axios.get(
          `https://api.coingecko.com/api/v3/coins/${crypto.coinId}/ohlc`,
          {
            params: {
              vs_currency: 'usd',
              days,
            },
            timeout: 10000,
          }
        );
        apiCallCount++;
        console.log('OHLC rate limit headers:', ohlcResponse.headers);

        const historicalData = ohlcResponse.data.map((ohlc) => ({
          coinId: crypto.coinId,
          name: crypto.name,
          symbol: crypto.symbol,
          open: ohlc[1],
          high: ohlc[2],
          low: ohlc[3],
          close: ohlc[4],
          timestamp: new Date(ohlc[0]),
        }));

        cache[cacheKey] = {
          timestamp: Date.now(),
          data: historicalData,
        };

        return historicalData;
      });

      const historicalDataArrays = await Promise.all(historicalPromises);
      const historicalData = historicalDataArrays.flat();

      const bulkCryptoOps = cryptoData.map((crypto) => ({
        updateOne: {
          filter: { coinId: crypto.coinId },
          update: { $set: crypto },
          upsert: true,
        },
      }));

      const bulkHistoricalOps = historicalData.map((data) => ({
        insertOne: {
          document: data,
        },
      }));

      await Promise.all([
        Crypto.bulkWrite(bulkCryptoOps),
        HistoricalCrypto.bulkWrite(bulkHistoricalOps, { ordered: false }).catch((e) => {
          if (e?.writeErrors) {
            console.warn('Some historical records already exist (skipped)');
          } else {
            throw e;
          }
        }),
      ]);

      console.log(`✅ Batch (page ${page}) updated successfully`);
      return { success: true, error: null };
    } catch (error) {
      return {
        success: false,
        error: {
          message: error.message,
          code: error.code,
          status: error.response?.status,
        },
      };
    }
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    console.log(`Attempt ${attempt} of ${retries}`);
    apiCallCount = 0; // Reset API call count per attempt

    // Fetch first batch (coins 1-5)
    const batch1Result = await fetchBatch(1, batchSize);
    if (!batch1Result.success) {
      lastError = batch1Result.error;
      console.error(`❌ Batch 1 failed:`, lastError);
      if (lastError.status === 429 && attempt < retries) {
        console.log(`Rate limit hit, waiting ${baseDelay / 1000}s before retry...`);
        await new Promise((resolve) => setTimeout(resolve, baseDelay * Math.pow(2, attempt - 1)));
        continue;
      }
    }

    // Wait before fetching second batch
    if (batch1Result.success) {
      console.log(`Waiting ${batchDelay / 1000}s before fetching second batch...`);
      await new Promise((resolve) => setTimeout(resolve, batchDelay));
      
      // Fetch second batch (coins 6-10)
      const batch2Result = await fetchBatch(2, batchSize);
      if (!batch2Result.success) {
        lastError = batch2Result.error;
        console.error(`❌ Batch 2 failed:`, lastError);
        if (lastError.status === 429 && attempt < retries) {
          console.log(`Rate limit hit, waiting ${baseDelay / 1000}s before retry...`);
          await new Promise((resolve) => setTimeout(resolve, baseDelay * Math.pow(2, attempt - 1)));
          continue;
        }
      }

      if (batch1Result.success && batch2Result.success) {
        console.log(`✅ Crypto data updated successfully (Attempt ${attempt})`);
        console.log(`Total API calls made: ${apiCallCount}`);
        return { success: true, error: null };
      }
    }

    if (attempt === retries) {
      console.error('Max retries reached, aborting fetch');
      const cachedData = Object.values(cache).find((c) => c.data && Date.now() - c.timestamp < CACHE_DURATION);
      if (cachedData) {
        console.log('Using cached data as fallback due to rate limit');
        return { success: true, data: cachedData.data };
      }
      return { success: false, error: lastError };
    }
  }

  return { success: false, error: lastError };
};

const startCryptoJob = () => {
  cron.schedule('0 * * * *', async () => {
    if (isJobRunning) {
      console.log('Crypto job already running, skipping...');
      return;
    }
    isJobRunning = true;
    try {
      console.log('⏱️ Running crypto data fetch job...');
      await fetchCryptoData(3, 120000, 1, 5, 5 * 60 * 1000); // 5 coins per batch, 5-minute delay
    } finally {
      isJobRunning = false;
    }
  });
  console.log('✅ Crypto job scheduled to run every hour');
};

module.exports = { startCryptoJob, fetchCryptoData };