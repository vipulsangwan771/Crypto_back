const mongoose = require('mongoose');

const cryptoSchema = new mongoose.Schema({
  coinId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  symbol: { type: String, required: true },
  currentPrice: { type: Number, required: true },
  marketCap: { type: Number, required: true },
  priceChange24h: { type: Number },
  lastUpdated: { type: Date, default: Date.now },
});

cryptoSchema.index({ marketCap: -1 });

module.exports = mongoose.model('Crypto', cryptoSchema);
