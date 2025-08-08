# 🔐 Crypto Tracker - Backend

This is the **backend server** for the Crypto Tracker application. It is built using **Node.js**, **Express**, and **MongoDB**, and handles secure API routes for fetching real-time and historical cryptocurrency data using the **CoinGecko API**. It includes automated cron jobs, proper error handling, and a plug-and-play authentication middleware.

## Tech Stack

- **Server**: Node.js, Express  
- **Database**: MongoDB Atlas, Mongoose  
- **API Source**: CoinGecko API  
- **Scheduler**: node-cron  
- **Security**: Helmet, CORS, express-rate-limit  
- **Deployment**:  
  - **Backend**: Render  
  - **Database**: MongoDB Atlas

---

## Setup Instructions

### Prerequisites

- Node.js (v16 or higher)  
- MongoDB Atlas account  
- Git

---

### Backend Setup

1. Clone the repository and navigate to the backend folder:

   ```bash
   git clone https://github.com/vipulsangwan771/Crypto_back.git
   cd Crypto_back
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create a `.env` file in the root:

   ```
   MONGODB_URI=your_mongodb_connection_string
   PORT=5000
   ```

4. Start the backend server:

   ```bash
   node server.js
   ```

---

## API Endpoints

> All endpoints require authentication middleware (customizable in `/middleware/auth.js`)

- **GET /api/crypto**  
  Returns top 10 cryptocurrencies by market cap.  
  **Query Params**: `search` (optional) – filter by name or symbol.

- **GET /api/crypto/historical/:coinId**  
  Returns the 60 most recent historical records (OHLC) for a coin.

- **GET /api/crypto/chart/:coinId**  
  Returns 3-day chart data for a given coin in candlestick format.

---

## Cron Job

The server uses **node-cron** to fetch and store data every 30 minutes:

- **Location**: `jobs/cryptoJob.js`
- **Fetches**:
  - Top 10 coins with current price, market cap, and 24h change.
  - 7-day OHLC historical data for charting.
- **Saves data in**:
  - `Crypto` collection (latest snapshot)
  - `HistoricalCrypto` collection (timestamped historical records)

---
## How the Cron Job Works


The backend uses **node-cron** to automate cryptocurrency data fetching every **30 minutes**.  
This ensures that the database always contains fresh market data and recent historical records without manual intervention.

**Workflow**:

1. **Trigger** – Every 30 minutes, `node-cron` executes the `cryptoJob.js` script.
2. **Fetch Data** –  
   - Calls the **CoinGecko API** to get:
     - **Top 10 cryptocurrencies** sorted by market cap (current price, market cap, 24h change).
     - **7-day OHLC (Open, High, Low, Close)** data for each coin.
3. **Store Data** –  
   - Saves **latest snapshot** in the `Crypto` collection (overwrites old data).
   - Appends **historical records** to the `HistoricalCrypto` collection with timestamps for tracking price trends over time.
4. **Error Handling** –  
   - If the API call fails, logs the error without crashing the server.
   - Retries automatically on the next scheduled run.
5. **Usage in API** –  
   - `GET /api/crypto` reads from the `Crypto` collection.
   - `GET /api/crypto/historical/:coinId` reads from the `HistoricalCrypto` collection.

**Schedule Expression**:  
```javascript
cron.schedule("*/30 * * * *", cryptoJob);
```


## Project Structure

```
Crypto_back/
├── routes/
│   └── crypto.js             # API routes
├── jobs/
│   └── cryptoJob.js          # Scheduled fetch jobs
├── models/
│   ├── Crypto.js
│   └── HistoricalCrypto.js
├── middleware/
│   └── auth.js               # Auth middleware (customizable)
├── server.js                 # App entry point
├── .env                      # Environment variables
```

---

## Deployment

- **Backend**: Render  
  API Base URL: _(https://crypto-back-nmg4.onrender.com)_  
- **Database**: MongoDB Atlas  
- **Collections**:
  - `Crypto` – Latest market data  
  - `HistoricalCrypto` – OHLC snapshots (every 30 min)

---

## Author

**Vipul Sangwan**  
GitHub: [@vipulsangwan771](https://github.com/vipulsangwan771)

---

## License

This project is licensed under the **MIT License**.
