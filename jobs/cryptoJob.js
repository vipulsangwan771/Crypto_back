const cron = require('node-cron');
const axios = require('axios');
const Crypto = require('../models/Crypto');
const HistoricalCrypto = require('../models/HistoricalCrypto');

const cache = {};
const CACHE_DURATION = 30 * 60 * 1000; 

const fetchCryptoData = async (retries = 3, baseDelay = 60000, days = 3) => {
  let lastError = null;
  let apiCallCount = 0;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Step 1: Fetch Top 10 Coins (Latest Snapshot)
      console.log(`Attempt ${attempt}: Fetching market data...`);
      const marketResponse = await axios.get(
        'https://api.coingecko.com/api/v3/coins/markets',
        {
          params: {
            vs_currency: 'usd',
            order: 'market_cap_desc',
            per_page: 10,
            page: 1,
            sparkline: false,
            price_change_percentage: '24h',
          },
          timeout: 10000,
        }
      );
      apiCallCount++;
      console.log(`Market data fetched (API call #${apiCallCount})`);

      const cryptoData = marketResponse.data.map((coin) => ({
        coinId: coin.id ?? 'unknown',
        name: coin.name ?? 'Unknown',
        symbol: coin.symbol ?? 'UNK',
        currentPrice: coin.current_price ?? 0,
        marketCap: coin.market_cap ?? 0,
        priceChange24h: coin.price_change_percentage_24h ?? 0,
        lastUpdated: new Date(coin.last_updated || Date.now()),
      }));

      // Step 2: Fetch Historical OHLC (3 days)
      const historicalPromises = cryptoData.map(async (crypto, index) => {
        const cacheKey = `${crypto.coinId}_ohlc_${days}d`;
        const cachedData = cache[cacheKey];

        // Check cache
        if (cachedData && Date.now() - cachedData.timestamp < CACHE_DURATION) {
          console.log(`Using cached data for ${crypto.coinId}`);
          return cachedData.data;
        }

        // Stagger requests to avoid rate limits (2-second delay per coin)
        await new Promise((resolve) => setTimeout(resolve, index * 2000));

        console.log(`Fetching OHLC for ${crypto.coinId} (API call #${apiCallCount + 1})`);
        const ohlcResponse = await axios.get(
          `https://api.coingecko.com/api/v3/coins/${crypto.coinId}/ohlc`,
          {
            params: {
              vs_currency: 'usd',
              days, // Fetch 3 days of data
            },
            timeout: 10000,
          }
        );
        apiCallCount++;

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

        // Cache the data
        cache[cacheKey] = {
          timestamp: Date.now(),
          data: historicalData,
        };

        return historicalData;
      });

      const historicalDataArrays = await Promise.all(historicalPromises);
      const historicalData = historicalDataArrays.flat();
      console.log(`Total API calls made: ${apiCallCount}`);

      // Step 3: Update MongoDB
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

      console.log(`✅ Crypto data updated successfully (Attempt ${attempt})`);
      return { success: true, error: null };
    } catch (error) {
      lastError = {
        message: error.message,
        code: error.code,
        status: error.response?.status,
      };
      console.error(`❌ Attempt ${attempt} failed:`, lastError);
      if (attempt === retries) {
        console.error('Max retries reached, aborting fetch');
        return { success: false, error: lastError };
      }
      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.log(`Waiting ${delay / 1000}s before retry...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return { success: false, error: lastError };
};

const startCryptoJob = () => {
  cron.schedule('*/30 * * * *', async () => {
    console.log('⏱️ Running crypto data fetch job...');
    await fetchCryptoData(3, 60000, 3); // Fetch 3 days of data
  });
  console.log('✅ Crypto job scheduled to run every 30 minutes');
};

module.exports = { startCryptoJob, fetchCryptoData };
