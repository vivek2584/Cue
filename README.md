# Cue

A smart, real-time watchlist application that uses statistical volatility to identify notable market movements, augmented by an Agentic AI assistant.

## Key Features
- **Personalized Baseline Tracking**: Instead of daily changes, Cue tracks how much a stock has moved since the exact moment you added it to your watchlist.
- **Statistical Attention Engine**: A mathematical model analyzes 30-day historical volatility to highlight stocks moving abnormally (orange) and mute stocks having a normal day (grey).
- **Agentic AI Assistant**: A built-in chat assistant powered by Groq has live access to your database to explain signals and summarize your personalized portfolio.
- **High-Frequency Pipeline**: Real-time WebSocket market data (Finnhub) is aggressively cached and processed in Redis to deliver instant UI updates without overwhelming the database.

## Screenshots

### 1. Smart Dashboard & Baseline Tracking
*The main ledger dashboard, showing the price movement of watched stocks.*
![Dashboard](./docs/dashboard.png)

### 2. Statistical Attention Engine & Deep Dive
*Clicking a stock opens the detail drawer, revealing the 30-day historical volatility chart and the AI analysis.*
![Stock Detail Drawer](./docs/stock-detail.png)

### 3. Agentic AI Assistant
*A built-in AI assistant that actively reads your live data from database and explains market signals.*
![AI Assistant](./docs/ai-assistant.png)

### 4. Real-time Watchlist Management
*Instantly search and add new stocks to begin tracking their price movement.*
![Add Symbol Modal](./docs/add-stock.png)

## Tech Stack
- **Frontend**: React, Vite, Tailwind CSS, Recharts
- **Backend**: Node.js, Express, Prisma (PostgreSQL), Redis
- **APIs**: Finnhub (Live Market Data), Groq (AI Assistant)

## Quick Start

1. **Install dependencies**
   ```bash
   cd frontend && npm install
   cd ../backend && npm install
   ```

2. **Environment Variables**
   Create a `.env` file in the root directory:
   ```env
   DATABASE_URL="postgresql://user:password@localhost:5432/cue"
   REDIS_URL="redis://localhost:6379"
   JWT_SECRET="your_secret_key"
   FINNHUB_API_KEY="your_finnhub_key"
   GROQ_API_KEY="your_groq_key"
   ```

3. **Database Setup**
   ```bash
   cd backend
   npx prisma db push
   ```

4. **Run Application**
   Start both development servers (in separate terminals):
   ```bash
   # Terminal 1: Frontend
   cd frontend && npm run dev

   # Terminal 2: Backend
   cd backend && npm run dev
   ```
