# NEXUS — AI Crypto Futures Trading Dashboard

A production-ready AI-powered crypto futures trading dashboard with full risk management.

## ⚠️ Important Warnings

- **Always start with PAPER_TRADING=true** and run for weeks before going live
- Never use more than you can afford to lose
- The 1% risk per trade and 5% daily drawdown limits exist for a reason — don't raise them without understanding Kelly criterion
- AI signals are not financial advice; they are probabilistic suggestions

---

## 🚀 Quick Setup

### 1. Clone & install
```bash
git clone <your-repo>
cd crypto-ai-trader
npm install
```

### 2. Configure environment
```bash
cp .env.example .env.local
# Edit .env.local with your API keys
```

Required keys:
| Key | Where to get it |
|-----|----------------|
| `BINANCE_API_KEY` / `BINANCE_SECRET` | Binance → API Management. Enable **Futures trading** only. **Never enable withdrawal.** |
| `BYBIT_API_KEY` / `BYBIT_SECRET` | Bybit → API (optional backup exchange) |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `TELEGRAM_BOT_TOKEN` | @BotFather on Telegram |
| `TELEGRAM_CHAT_ID` | Your Telegram user ID |
| `DASHBOARD_SECRET` | Any long random string — protects the execute endpoint |

### 3. Run locally
```bash
npm run dev
# Visit http://localhost:3000
```

### 4. Deploy to Vercel
```bash
# Push to GitHub first, then:
# 1. Go to vercel.com → New Project → Import your repo
# 2. Framework: Next.js (auto-detected)
# 3. Add all environment variables from .env.example
# 4. Deploy
```

---

## 🏗 Architecture

```
pages/
  index.tsx              — Main dashboard UI
  api/
    signal.ts            — GET  /api/signal    — AI signal generation
    portfolio.ts         — GET  /api/portfolio  — Portfolio state
    candles.ts           — GET  /api/candles    — OHLCV data
    trade/
      execute.ts         — POST /api/trade/execute — Order execution

lib/
  riskEngine.ts          — Risk validation, position sizing, circuit breaker
  signalEngine.ts        — Technical indicators + Claude AI signal
  exchange.ts            — ccxt wrapper (paper + live modes)
  alerts.ts              — Telegram notifications

components/
  StatCard.tsx           — Metric display card
  SignalPanel.tsx        — AI signal + execute button
  RiskGauge.tsx          — Daily loss and position usage bars
```

---

## 🛡 Risk Management Rules

Every trade passes through `validateTrade()` in `lib/riskEngine.ts`:

1. **Circuit breaker**: If daily loss ≥ 5%, all trading stops until the next day
2. **Max positions**: Never more than 3 simultaneous open positions
3. **Min AI confidence**: Only trade if Claude confidence ≥ 65%
4. **Leverage cap**: Hard max of 5x regardless of what the AI suggests
5. **Stop loss required**: Trade rejected if no stop loss or stop > 10% away
6. **Position sizing**: Fixed 1% risk — size calculated from stop loss distance
7. **Correlation check**: Won't open BTC + ETH simultaneously (correlated group)

Override these in `.env.local` or edit `DEFAULT_RISK_CONFIG` in `lib/riskEngine.ts`.

---

## 📊 Going Live Checklist

- [ ] Run paper trading for at least 30 days
- [ ] Sharpe ratio > 1.0 in paper mode
- [ ] Max drawdown < 15% in paper mode
- [ ] Win rate > 45% (futures needs good R:R, not just win rate)
- [ ] Telegram alerts verified working
- [ ] Kill switch tested (close all positions manually)
- [ ] Start live with 10% of intended capital
- [ ] Set `PAPER_TRADING=false` in Vercel env vars
- [ ] Re-run Monte Carlo simulation on recent paper data

---

## 🔧 Extending the System

### Add a new exchange
Edit `lib/exchange.ts` → `createExchange()` to add another ccxt exchange.

### Add technical indicators
Edit `lib/signalEngine.ts` → `buildIndicators()`.

### Change AI model
Edit `lib/signalEngine.ts` → `generateSignal()` — change the model string and system prompt.

### Add more risk rules
Edit `lib/riskEngine.ts` → `validateTrade()` — add more checks before the `approved: true` return.
