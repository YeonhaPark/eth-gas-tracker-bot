// index.js
require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const chatId = process.env.CHAT_ID;
const rpcUrl = process.env.ALCHEMY_RPC;
const arbRpcUrl = 'https://arb1.arbitrum.io/rpc';
const optRpcUrl = 'https://mainnet.optimism.io';

const HISTORY_FILE = 'gas-history.json';
const POLL_INTERVAL_MS = 20 * 60 * 1000; // 20분

if (!fs.existsSync(HISTORY_FILE)) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify({ history: [] }, null, 2));
}

const loadHistory = () => JSON.parse(fs.readFileSync(HISTORY_FILE));
const saveHistory = (history) => fs.writeFileSync(HISTORY_FILE, JSON.stringify({ history }, null, 2));

const getGasPriceFrom = async (url) => {
  const res = await axios.post(url, {
    jsonrpc: '2.0',
    method: 'eth_gasPrice',
    params: [],
    id: 1,
  });
  return parseFloat((parseInt(res.data.result, 16) / 1e9).toFixed(3));
};

const getGasTiers = () => ({ low: 2.4, average: 2.6, high: 2.8 });

const getETHPriceUSD = async () => {
  const res = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
  return res.data.ethereum.usd;
};

const formatLocalTime = (isoString, userTimeZone = 'UTC') => new Date(isoString).toLocaleString(undefined, { timeZone: userTimeZone });
const getGreeting = () => {
  const hour = new Date().getHours();
  return hour < 12 ? '🌅 Good morning!' : hour < 18 ? '🌤 Good afternoon!' : '🌙 Good evening!';
};

const trackGas = async () => {
  try {
    const current = await getGasPriceFrom(rpcUrl);
    const now = new Date().toISOString();
    const history = [...loadHistory().history, { time: now, gwei: current }].filter(
      entry => new Date(entry.time).getTime() >= Date.now() - 7 * 24 * 60 * 60 * 1000
    );
    saveHistory(history);
    const gweis = history.map(e => e.gwei);
    const min = Math.min(...gweis), max = Math.max(...gweis);
    if (current < min || current > max) {
      await bot.sendMessage(chatId, `${current < min ? '📉 New 7d Low' : '📈 New 7d High'}: ${current} gwei\n${formatLocalTime(now)}`);
    }
    console.log(`[${formatLocalTime(now)}] Current: ${current} gwei | Min(7d): ${min}, Max(7d): ${max}`);
  } catch (err) {
    console.error('Error tracking gas:', err.message);
  }
};

const replyGasMessage = async (msg, label, rpc, emoji, imageUrl) => {
  const now = formatLocalTime(new Date().toISOString());
  const ethPrice = await getETHPriceUSD();
  const gwei = await getGasPriceFrom(rpc);
  const usd = ((gwei * 1e-9 * 21000) * ethPrice).toFixed(2);
  bot.sendPhoto(msg.chat.id, imageUrl, {
    caption: `${emoji} ${label} Gas Price\n${gwei} gwei ($${usd})\n🕒 ${now}`
  });
};

bot.onText(/\/mainnet/, async (msg) => {
  const now = formatLocalTime(new Date().toISOString());
  const ethPrice = await getETHPriceUSD();
  const gas = getGasTiers();
  const gasUnitsUSD = gwei => ((gwei * 1e-9 * 21000) * ethPrice).toFixed(2);
  bot.sendMessage(msg.chat.id, `Ethereum Gas Fee (typical tx)

📉 Low: ${gas.low} gwei ($${gasUnitsUSD(gas.low)})
📊 Average: ${gas.average} gwei ($${gasUnitsUSD(gas.average)})
📈 High: ${gas.high} gwei ($${gasUnitsUSD(gas.high)})

🕒 ${now}`);
});

bot.onText(/\/arbitrum/, msg => replyGasMessage(
  msg,
  'Arbitrum',
  arbRpcUrl,
  'https://cryptologos.cc/logos/arbitrum-arb-logo.png'
));

bot.onText(/\/optimism/, msg => replyGasMessage(
  msg,
  'Optimism',
  optRpcUrl,
  'https://cryptologos.cc/logos/optimism-ethereum-op-logo.png'
));

bot.onText(/\/start/, async (msg) => {
  const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const greeting = getGreeting();
  const now = formatLocalTime(new Date().toISOString(), userTimeZone);
  const commands = `\nAvailable commands:\n/mainnet – Ethereum gas tiers\n/arbitrum – Arbitrum gas price\n/optimism – Optimism gas price\n/help – ℹ️ Show help menu`;
  await bot.sendMessage(msg.chat.id, `${greeting} 👋\nI'm your Ethereum gas tracker bot.\n🕒 Current time: ${now}${commands}`);
});

bot.onText(/\/help/, async (msg) => {
  const commands = `\nAvailable commands:\n/mainnet – Ethereum gas tiers\n/arbitrum – Arbitrum gas price\n/optimism – Optimism gas price`;
  bot.sendMessage(msg.chat.id, `ℹ️ Help Menu${commands}`);
});

const dailySummary = async () => {
  const last24h = loadHistory().history.filter(entry => new Date(entry.time).getTime() >= Date.now() - 24 * 60 * 60 * 1000);
  if (last24h.length === 0) return;
  const min = Math.min(...last24h.map(e => e.gwei));
  const max = Math.max(...last24h.map(e => e.gwei));
  const now = formatLocalTime(new Date().toISOString());
  await bot.sendMessage(chatId, `📊 Daily Gas Report\n📉 Low: ${min} gwei\n📈 High: ${max} gwei\n🕒 ${now}`);
};

setInterval(trackGas, POLL_INTERVAL_MS);
setInterval(dailySummary, 24 * 60 * 60 * 1000);
trackGas();
