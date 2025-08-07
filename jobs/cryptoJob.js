const cron = require('node-cron');
const axios = require('axios');
const Crypto = require('../models/Crypto');
const HistoricalCrypto = require('../models/HistoricalCrypto');

const fetchCryptoData = async (retries = 3, baseDelay = 30000) => {
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Step 1: Fetch Top 10 Coins (Latest Snapshot)
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

      const cryptoData = marketResponse.data.map((coin) => ({
        coinId: coin.id ?? 'unknown',
        name: coin.name ?? 'Unknown',
        symbol: coin.symbol ?? 'UNK',
        currentPrice: coin.current_price ?? 0,
        marketCap: coin.market_cap ?? 0,
        priceChange24h: coin.price_change_percentage_24h ?? 0,
        lastUpdated: new Date(coin.last_updated || Date.now()),
      }));

      // ✅ Overwrite or Upsert Latest Crypto Stats
      const bulkCryptoOps = cryptoData.map((crypto) => ({
        updateOne: {
          filter: { coinId: crypto.coinId },
          update: { $set: crypto },
          upsert: true,
        },
      }));

      // Step 2: Fetch 7-day Historical OHLC
      const historicalPromises = cryptoData.map(async (crypto) => {
        const ohlcResponse = await axios.get(
          `https://api.coingecko.com/api/v3/coins/${crypto.coinId}/ohlc`,
          {
            params: {
              vs_currency: 'usd',
              days: 7, // ✅ LIMIT to 7 days to avoid 429
            },
            timeout: 10000,
          }
        );

        return ohlcResponse.data.map((ohlc) => ({
          coinId: crypto.coinId,
          name: crypto.name,
          symbol: crypto.symbol,
          open: ohlc[1],
          high: ohlc[2],
          low: ohlc[3],
          close: ohlc[4],
          timestamp: new Date(ohlc[0]),
        }));
      });

      const historicalDataArrays = await Promise.all(historicalPromises);
      const historicalData = historicalDataArrays.flat();

      // ✅ Append Historical Data (no update or overwrite)
      const bulkHistoricalOps = historicalData.map((data) => ({
        insertOne: {
          document: data,
        },
      }));

      await Promise.all([
        Crypto.bulkWrite(bulkCryptoOps),
        HistoricalCrypto.bulkWrite(bulkHistoricalOps, { ordered: false }).catch((e) => {
          // Ignore duplicate timestamp errors
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
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return { success: false, error: lastError };
};

const startCryptoJob = () => {
  cron.schedule('*/30 * * * *', async () => {
    console.log('⏱️ Running crypto data fetch job...');
    await fetchCryptoData();
  });
  console.log('✅ Crypto job scheduled to run every 30 minutes');
};

module.exports = { startCryptoJob, fetchCryptoData };
