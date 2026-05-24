/**
 * lib/alerts.ts
 * Telegram bot notifications for all important events.
 * Set up a bot via @BotFather on Telegram and add tokens to .env
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const CHAT_ID = process.env.TELEGRAM_CHAT_ID

async function sendTelegram(message: string) {
  if (!BOT_TOKEN || !CHAT_ID) return  // Silently skip if not configured

  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text: message,
      parse_mode: 'HTML',
    }),
  }).catch(console.error)
}

export const alerts = {
  tradeOpened: (symbol: string, side: string, entry: number, sl: number, tp: number, size: number, confidence: number, mode: string) =>
    sendTelegram(
      `🟢 <b>TRADE OPENED [${mode.toUpperCase()}]</b>\n` +
      `📊 ${symbol} ${side.toUpperCase()}\n` +
      `💰 Entry: $${entry.toFixed(2)}\n` +
      `🛑 Stop Loss: $${sl.toFixed(2)}\n` +
      `🎯 Take Profit: $${tp.toFixed(2)}\n` +
      `📦 Size: ${size.toFixed(4)}\n` +
      `🤖 AI Confidence: ${(confidence * 100).toFixed(1)}%`
    ),

  tradeClosed: (symbol: string, side: string, pnl: number, pnlPct: number, reason: string) =>
    sendTelegram(
      `${pnl >= 0 ? '✅' : '❌'} <b>TRADE CLOSED</b>\n` +
      `📊 ${symbol} ${side.toUpperCase()}\n` +
      `${pnl >= 0 ? '💚' : '💔'} PnL: $${pnl.toFixed(2)} (${(pnlPct * 100).toFixed(2)}%)\n` +
      `📝 Reason: ${reason.toUpperCase()}`
    ),

  circuitBreaker: (dailyLoss: number) =>
    sendTelegram(
      `🚨 <b>CIRCUIT BREAKER TRIGGERED</b>\n` +
      `Daily loss: ${(dailyLoss * 100).toFixed(2)}% — Trading paused until tomorrow.\n` +
      `Manual review required before resuming.`
    ),

  tradeRejected: (symbol: string, reason: string) =>
    sendTelegram(
      `⚠️ <b>TRADE REJECTED</b>\n` +
      `📊 ${symbol}\n` +
      `❌ Reason: ${reason}`
    ),

  systemError: (error: string) =>
    sendTelegram(`🔴 <b>SYSTEM ERROR</b>\n<code>${error}</code>`),

  dailySummary: (trades: number, pnl: number, pnlPct: number, winRate: number) =>
    sendTelegram(
      `📈 <b>DAILY SUMMARY</b>\n` +
      `Trades: ${trades}\n` +
      `PnL: $${pnl.toFixed(2)} (${(pnlPct * 100).toFixed(2)}%)\n` +
      `Win Rate: ${(winRate * 100).toFixed(1)}%`
    ),
}
