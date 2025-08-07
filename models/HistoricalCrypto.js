const mongoose = require('mongoose');

const HistoricalCryptoSchema = new mongoose.Schema({
  coinId: { type: String, required: true },
  name: { type: String, required: true },
  symbol: { type: String, required: true },
  open: { type: Number, required: true },
  high: { type: Number, required: true },
  low: { type: Number, required: true },
  close: { type: Number, required: true },
  volume: { type: Number },
  timestamp: { type: Date, required: true, default: Date.now },
});

HistoricalCryptoSchema.index({ coinId: 1, timestamp: 1 });

module.exports = mongoose.model('HistoricalCrypto', HistoricalCryptoSchema);
