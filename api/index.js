import express from 'express';
import cors from 'cors';
import axios from 'axios';
import crypto from 'crypto';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();

// Initialize Supabase Client (Service Role key bypasses RLS for backend write access)
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = (supabaseUrl && supabaseServiceKey)
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    })
  : null;

if (supabase) {
  console.log('Supabase client successfully initialized.');
} else {
  console.warn('Supabase credentials missing, falling back to local file system.');
}

// Get pool.json file path, using /tmp directory in Vercel to bypass Read-Only File System (EROFS)
const POOL_FILE_PATH = process.env.VERCEL
  ? path.join('/tmp', 'pool.json')
  : path.join(process.cwd(), 'api', 'pool.json');

// Initialize /tmp/pool.json if it doesn't exist on Vercel
if (process.env.VERCEL && !fs.existsSync(POOL_FILE_PATH)) {
  try {
    const templatePath = path.join(process.cwd(), 'api', 'pool.json');
    if (fs.existsSync(templatePath)) {
      fs.copyFileSync(templatePath, POOL_FILE_PATH);
    }
  } catch (err) {
    console.error('Failed to initialize pool.json in /tmp:', err.message);
  }
}

// Helper to hash current investors state to prevent race conditions
function getInvestorsHash(investors) {
  if (!Array.isArray(investors)) return '';
  // Sort by id to ensure deterministic order, then stringify and hash
  const sorted = [...investors].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}

// Helper to get pool data from Supabase with fallback to local file
async function getPoolData() {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('pool_state')
        .select('*')
        .eq('id', 1)
        .single();
      
      if (error) throw error;
      if (data) {
        return {
          isStarted: data.is_started,
          startBalanceIdr: parseFloat(data.start_balance_idr || 0),
          cycleStartTime: data.cycle_start_time ? parseInt(data.cycle_start_time) : null,
          investors: data.investors || [],
          history: data.history || []
        };
      }
    } catch (err) {
      console.error('Supabase getPoolData failed, falling back to local file:', err.message);
    }
  }

  if (fs.existsSync(POOL_FILE_PATH)) {
    const data = fs.readFileSync(POOL_FILE_PATH, 'utf8');
    return JSON.parse(data);
  }
  return {
    isStarted: false,
    startBalanceIdr: 0,
    cycleStartTime: null,
    investors: [],
    history: []
  };
}

// Helper to save pool data to Supabase with fallback to local file
async function savePoolData(pool) {
  if (supabase) {
    try {
      const { error } = await supabase
        .from('pool_state')
        .update({
          is_started: pool.isStarted,
          start_balance_idr: pool.startBalanceIdr,
          cycle_start_time: pool.cycleStartTime,
          investors: pool.investors,
          history: pool.history
        })
        .eq('id', 1);
      
      if (error) throw error;
      return true;
    } catch (err) {
      console.error('Supabase savePoolData failed, falling back to local file:', err.message);
    }
  }

  fs.writeFileSync(POOL_FILE_PATH, JSON.stringify(pool, null, 2), 'utf8');
  return true;
}

// Allowed origins for CORS (including port 3002 for our frontend)
const rawFrontendUrl = process.env.FRONTEND_URL || '';
const explicitOrigins = rawFrontendUrl
  ? rawFrontendUrl.split(',').map(u => u.trim()).filter(Boolean)
  : [];

const localOrigins = [
  'http://localhost:3002', 
  'http://localhost:5173', 
  'http://localhost:4173', 
  'http://localhost:3000'
];
const allowedOrigins = [...explicitOrigins, ...localOrigins];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (origin.endsWith('.vercel.app')) {
      try {
        const hostname = new URL(origin).hostname;
        if (hostname.includes('invest-monitor') || hostname.includes('despectus-capital')) return callback(null, true);
      } catch {
        // URL parsing error, ignore
      }
    }
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Origin not allowed by CORS policy.'));
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '10kb' }));

// In-memory rate limiter (limits each IP to 25 requests/min)
const rateLimitStore = new Map();
function createRateLimiter(maxRequests = 25, windowMs = 60000) {
  return (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const windowStart = now - windowMs;

    const timestamps = (rateLimitStore.get(ip) || []).filter(t => t > windowStart);

    if (timestamps.length >= maxRequests) {
      return res.status(429).json({
        success: false,
        error: 'Terlalu banyak permintaan. Coba lagi dalam semenit.'
      });
    }

    timestamps.push(now);
    rateLimitStore.set(ip, timestamps);

    if (rateLimitStore.size > 1000) {
      for (const [key, times] of rateLimitStore.entries()) {
        const validTimes = times.filter(t => t > windowStart);
        if (validTimes.length === 0) {
          rateLimitStore.delete(key);
        } else {
          rateLimitStore.set(key, validTimes);
        }
      }
    }

    next();
  };
}

const bybitLimiter = createRateLimiter(25, 60000);

// Helper to generate Bybit API v5 HMAC Signature
function generateBybitSignature(apiKey, apiSecret, timestamp, recvWindow, queryString) {
  const message = timestamp + apiKey + recvWindow + queryString;
  return crypto.createHmac('sha256', apiSecret).update(message).digest('hex');
}

// Helper to call Bybit API with User-Agent and failover domains
async function callBybit(endpoint, headers, method = 'GET', data = null) {
  const customHeaders = {
    ...headers,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };

  const config = { method, headers: customHeaders };
  if (data) config.data = data;

  try {
    config.url = `https://api.bybit.com${endpoint}`;
    return await axios(config);
  } catch (err) {
    const is403OrNetworkErr = !err.response || err.response.status === 403;
    if (is403OrNetworkErr) {
      console.warn(`Bybit primary domain failed (${err.message}). Retrying with api.bytick.com...`);
      config.url = `https://api.bytick.com${endpoint}`;
      return await axios(config);
    }
    throw err;
  }
}

// Sanitize error messages
function sanitizeError(err) {
  if (!err) return 'Terjadi kesalahan yang tidak diketahui.';
  const msg = String(err);
  if (msg.includes('API key') || msg.includes('signature') || msg.includes('timestamp')) {
    return 'Autentikasi API gagal. Periksa API key dan secret Anda.';
  }
  if (msg.includes('network') || msg.includes('ECONNREFUSED') || msg.includes('timeout')) {
    return 'Gagal terhubung ke Exchange. Periksa koneksi internet Anda.';
  }
  if (msg.includes('10001') || msg.includes('10003') || msg.includes('10004')) {
    return 'Autentikasi API gagal. API key mungkin tidak valid atau tidak memiliki izin.';
  }
  return 'API Exchange mengembalikan error. Coba lagi nanti.';
}

// Route to get USD to IDR conversion rate (Bybit P2P Rate first, with fallback)
app.get('/api/rates', async (req, res) => {
  try {
    // 1. Try to get USDT/IDR P2P price from Bybit P2P API
    try {
      const p2pResponse = await axios.post('https://api2.bybit.com/fiat/otc/item/online', {
        tokenId: 'USDT',
        currencyId: 'IDR',
        side: '1', // 1 = Buy side (seller's asking price = USDT price in IDR)
        size: '5',
        page: '1',
      }, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        timeout: 5000
      });

      if (p2pResponse.data?.result?.items && p2pResponse.data.result.items.length > 0) {
        const rate = parseFloat(p2pResponse.data.result.items[0].price);
        if (rate > 10000 && rate < 25000) {
          console.log(`Successfully fetched Bybit P2P rate: Rp ${rate}`);
          return res.json({ success: true, rate, source: 'bybit_p2p' });
        }
      }
    } catch (p2pError) {
      console.warn('Bybit P2P rate fetch failed:', p2pError.message);
    }

    // 2. Fallback to ExchangeRate API
    const response = await axios.get('https://open.er-api.com/v6/latest/USD', { timeout: 5000 });
    const rate = response.data?.rates?.IDR || 16400;
    res.json({ success: true, rate, source: 'er-api' });
  } catch (error) {
    console.error('Error fetching fallback exchange rates:', error.message);
    res.json({ success: false, rate: 16400, message: 'Using default fallback exchange rate', source: 'default' });
  }
});

// Route to check if Bybit API keys are configured on the server side
app.get('/api/bybit/config', (req, res) => {
  const hasServerKeys = !!(process.env.BYBIT_API_KEY && process.env.BYBIT_API_SECRET);
  res.json({
    success: true,
    hasServerKeys,
    accountTypes: process.env.BYBIT_ACCOUNT_TYPES ? process.env.BYBIT_ACCOUNT_TYPES.split(',') : ['UNIFIED', 'FUND']
  });
});

// Admin authentication details
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  console.error('FATAL: Environment variable ADMIN_PASSWORD is required to run the server.');
  process.exit(1);
}
const ADMIN_TOKEN = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest('hex');

// Route to handle admin login
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    return res.json({ success: true, token: ADMIN_TOKEN });
  }
  res.status(401).json({ success: false, error: 'Password salah!' });
});

// Middleware to authenticate admin token
function authenticateAdmin(req, res, next) {
  const token = req.headers['authorization'];
  if (token === ADMIN_TOKEN || token === `Bearer ${ADMIN_TOKEN}`) {
    return next();
  }
  res.status(403).json({ success: false, error: 'Akses ditolak. Silakan login kembali.' });
}

// Route to get the entire pool state
app.get('/api/pool', async (req, res) => {
  try {
    const pool = await getPoolData();
    res.json({ 
      success: true, 
      pool, 
      isDbConnected: !!supabase,
      hash: getInvestorsHash(pool.investors)
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Route to update investors list (requires auth)
app.post('/api/pool/investors', authenticateAdmin, async (req, res) => {
  try {
    const { investors, startBalanceIdr, expectedHash } = req.body;
    if (!Array.isArray(investors)) {
      return res.status(400).json({ success: false, error: 'Format data tidak valid.' });
    }
    const pool = await getPoolData();

    // Concurrency check using investors hash
    if (expectedHash) {
      const currentHash = getInvestorsHash(pool.investors);
      if (currentHash !== expectedHash) {
        return res.status(409).json({ 
          success: false, 
          error: 'Konflik data: Investor telah diubah oleh administrator lain. Halaman Anda akan dimuat ulang.' 
        });
      }
    }

    pool.investors = investors;
    if (startBalanceIdr !== undefined) {
      pool.startBalanceIdr = parseFloat(startBalanceIdr);
    }
    await savePoolData(pool);
    res.json({ success: true, pool, hash: getInvestorsHash(pool.investors) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Route to start the cycle (requires auth)
app.post('/api/pool/start', authenticateAdmin, async (req, res) => {
  try {
    const { startBalanceIdr } = req.body;
    if (startBalanceIdr === undefined || isNaN(startBalanceIdr)) {
      return res.status(400).json({ success: false, error: 'Saldo awal tidak valid.' });
    }
    const pool = await getPoolData();
    pool.isStarted = true;
    pool.startBalanceIdr = parseFloat(startBalanceIdr);
    pool.cycleStartTime = Date.now();
    
    // Initialize or append start balance to history
    const todayLabel = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
    if (!pool.history) pool.history = [];
    
    const existingIdx = pool.history.findIndex(h => h.date === todayLabel);
    if (existingIdx !== -1) {
      pool.history[existingIdx].balance = pool.startBalanceIdr;
    } else {
      pool.history.push({ date: todayLabel, balance: pool.startBalanceIdr });
    }
    
    await savePoolData(pool);
    res.json({ success: true, pool });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Route to reset the cycle (requires auth)
app.post('/api/pool/reset', authenticateAdmin, async (req, res) => {
  try {
    const { updatedInvestors, currentBalanceIdr, expectedHash } = req.body;
    if (!Array.isArray(updatedInvestors)) {
      return res.status(400).json({ success: false, error: 'Data investor tidak valid.' });
    }
    const pool = await getPoolData();

    // Check if any investor in the current pool has pending withdrawals
    const hasPending = pool.investors.some(inv => Array.isArray(inv.pendingWithdrawals) && inv.pendingWithdrawals.length > 0);
    if (hasPending) {
      return res.status(400).json({ success: false, error: 'Tidak dapat mereset siklus karena masih ada pending withdrawal.' });
    }

    // Concurrency check using investors hash
    if (expectedHash) {
      const currentHash = getInvestorsHash(pool.investors);
      if (currentHash !== expectedHash) {
        return res.status(409).json({ 
          success: false, 
          error: 'Konflik data: Investor telah diubah oleh administrator lain. Halaman Anda akan dimuat ulang.' 
        });
      }
    }

    pool.isStarted = false;
    pool.investors = updatedInvestors;
    pool.cycleStartTime = null;
    
    // Log the end-cycle balance to history if provided
    if (currentBalanceIdr !== undefined && !isNaN(currentBalanceIdr)) {
      const todayLabel = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
      if (!pool.history) pool.history = [];
      const existingIdx = pool.history.findIndex(h => h.date === todayLabel);
      if (existingIdx !== -1) {
        pool.history[existingIdx].balance = parseFloat(currentBalanceIdr);
      } else {
        pool.history.push({ date: todayLabel, balance: parseFloat(currentBalanceIdr) });
      }
    }
    
    await savePoolData(pool);
    res.json({ success: true, pool, hash: getInvestorsHash(pool.investors) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Route to save historical balance snapshot
app.post('/api/pool/history', authenticateAdmin, async (req, res) => {
  try {
    const { date, balance } = req.body;
    if (!date || balance === undefined || isNaN(balance)) {
      return res.status(400).json({ success: false, error: 'Data history tidak lengkap.' });
    }
    const pool = await getPoolData();
    if (!pool.history) pool.history = [];
    
    const existingIdx = pool.history.findIndex(h => h.date === date);
    if (existingIdx !== -1) {
      pool.history[existingIdx].balance = parseFloat(balance);
    } else {
      pool.history.push({ date, balance: parseFloat(balance) });
    }
    
    await savePoolData(pool);
    res.json({ success: true, pool, hash: getInvestorsHash(pool.investors) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Route to reset pool config back to default parameters (requires auth)
app.post('/api/admin/reset-investors', authenticateAdmin, async (req, res) => {
  try {
    const defaultPool = {
      isStarted: false,
      startBalanceIdr: 0,
      cycleStartTime: null,
      investors: [],
      history: []
    };
    await savePoolData(defaultPool);
    res.json({ success: true, message: 'Pool state direset ke default.', pool: defaultPool });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Short-term in-memory cache for spot prices to mitigate API timeouts/rate-limits
let cachedSpotPrices = {
  'USDT': 1.0,
  'USDC': 1.0,
  'BUSD': 1.0,
  'DAI': 1.0,
  'USD': 1.0,
  'USDE': 1.0
};
let lastSpotPriceFetch = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Helper to fetch current spot prices for coin-to-USD conversion
async function getSpotPrices() {
  const now = Date.now();
  if (now - lastSpotPriceFetch < CACHE_DURATION && Object.keys(cachedSpotPrices).length > 6) {
    return { ...cachedSpotPrices };
  }

  const priceMap = { ...cachedSpotPrices };

  try {
    let response;
    try {
      response = await axios.get('https://api.bybit.com/v5/market/tickers?category=spot', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        timeout: 8000
      });
    } catch (err) {
      console.warn(`Tickers failed on api.bybit.com (${err.message}). Trying api.bytick.com...`);
      response = await axios.get('https://api.bytick.com/v5/market/tickers?category=spot', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        timeout: 8000
      });
    }

    if (response.data && response.data.retCode === 0 && response.data.result?.list) {
      for (const item of response.data.result.list) {
        if (item.symbol.endsWith('USDT')) {
          const coin = item.symbol.replace('USDT', '');
          priceMap[coin] = parseFloat(item.lastPrice);
        }
      }
      cachedSpotPrices = priceMap;
      lastSpotPriceFetch = now;
    }
  } catch (error) {
    console.error('Error fetching spot prices, using cached values:', error.message);
  }
  return priceMap;
}

// Route to fetch Bybit balance securely on the server-side
app.post('/api/bybit/balance', bybitLimiter, async (req, res) => {
  // Support both server-configured keys and client-provided keys
  const apiKey = process.env.BYBIT_API_KEY || req.body.apiKey;
  const apiSecret = process.env.BYBIT_API_SECRET || req.body.apiSecret;

  if (!apiKey || !apiSecret || apiKey === 'dummy' || apiKey === 'mock') {
    return res.status(400).json({
      success: false,
      error: 'Bybit API Keys tidak terkonfigurasi. Hubungi administrator.'
    });
  }

  const accountTypes = process.env.BYBIT_ACCOUNT_TYPES
    ? process.env.BYBIT_ACCOUNT_TYPES.split(',')
    : ['UNIFIED', 'SPOT', 'FUND'];
  const recvWindow = '5000';
  const results = [];
  let totalUsdValue = 0;

  try {
    const spotPrices = await getSpotPrices();

    for (const accountType of accountTypes) {
      if (accountType === 'FUND') continue;

      const timestamp = Date.now().toString();
      const queryString = `accountType=${accountType}`;
      const signature = generateBybitSignature(apiKey, apiSecret, timestamp, recvWindow, queryString);

      const headers = {
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-RECV-WINDOW': recvWindow,
        'X-BAPI-SIGN': signature,
      };

      try {
        const response = await callBybit(`/v5/account/wallet-balance?${queryString}`, headers);
        const data = response.data;

        if (data.retCode === 0 && data.result?.list) {
          const accountData = data.result.list[0];
          let equity = parseFloat(accountData.totalEquity || accountData.totalWalletBalance || '0');

          const coins = (accountData.coin || []).map(c => ({
            coin: c.coin,
            equity: parseFloat(c.equity || '0'),
            usdValue: parseFloat(c.usdValue || '0'),
            walletBalance: parseFloat(c.walletBalance || '0')
          }));

          if (equity === 0 && coins.length > 0) {
            equity = coins.reduce((sum, c) => sum + c.usdValue, 0);
          }

          totalUsdValue += equity;
          results.push({ accountType, equity, coins, success: true });
        } else {
          results.push({
            accountType,
            success: false,
            error: sanitizeError(data.retMsg || `Error code ${data.retCode}`)
          });
        }
      } catch (err) {
        console.error(`Error fetching ${accountType} balance:`, err.message);
        results.push({
          accountType,
          success: false,
          error: sanitizeError(err.response?.data?.retMsg || err.message)
        });
      }
    }

    if (accountTypes.includes('FUND')) {
      const timestamp = Date.now().toString();
      const queryString = `accountType=FUND`;
      const signature = generateBybitSignature(apiKey, apiSecret, timestamp, recvWindow, queryString);

      const headers = {
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-RECV-WINDOW': recvWindow,
        'X-BAPI-SIGN': signature,
      };

      try {
        const response = await callBybit(`/v5/asset/transfer/query-account-coins-balance?${queryString}`, headers);
        const data = response.data;

        if (data.retCode === 0 && data.result?.balance) {
          let fundEquity = 0;
          const coins = [];

          for (const item of data.result.balance) {
            const coinName = item.coin;
            const amount = parseFloat(item.walletBalance || '0');
            if (amount <= 0) continue;

            const price = spotPrices[coinName] || 0;
            const usdVal = amount * price;
            fundEquity += usdVal;
            coins.push({ coin: coinName, walletBalance: amount, usdValue: usdVal });
          }

          totalUsdValue += fundEquity;
          results.push({ accountType: 'FUND', equity: fundEquity, coins, success: true });
        } else {
          results.push({
            accountType: 'FUND',
            success: false,
            error: sanitizeError(data.retMsg || `Error code ${data.retCode}`)
          });
        }
      } catch (err) {
        console.error(`Error fetching Funding balance:`, err.message);
        results.push({
          accountType: 'FUND',
          success: false,
          error: sanitizeError(err.response?.data?.retMsg || err.message)
        });
      }
    }

    const succeeded = results.some(r => r.success);
    if (!succeeded && results.length > 0) {
      return res.status(400).json({
        success: false,
        error: results.find(r => r.error)?.error || 'Gagal terhubung ke Bybit API.'
      });
    }

    res.json({ success: true, totalUsdValue, accounts: results });
  } catch (error) {
    console.error('Bybit Balance Serverless Error:', error.message);
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

// Route to fetch Bybit active positions securely
app.post('/api/bybit/positions', bybitLimiter, async (req, res) => {
  const apiKey = process.env.BYBIT_API_KEY || req.body.apiKey;
  const apiSecret = process.env.BYBIT_API_SECRET || req.body.apiSecret;

  if (!apiKey || !apiSecret || apiKey === 'dummy' || apiKey === 'mock') {
    return res.json({ success: true, positions: [] });
  }

  const categories = [
    { category: 'linear', settleCoin: 'USDT' },
    { category: 'inverse', settleCoin: 'BTC' }
  ];
  const positions = [];
  const recvWindow = '5000';

  try {
    for (const item of categories) {
      const timestamp = Date.now().toString();
      const queryString = item.settleCoin
        ? `category=${item.category}&settleCoin=${item.settleCoin}`
        : `category=${item.category}`;

      const signature = generateBybitSignature(apiKey, apiSecret, timestamp, recvWindow, queryString);
      const headers = {
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-RECV-WINDOW': recvWindow,
        'X-BAPI-SIGN': signature,
      };

      try {
        const response = await callBybit(`/v5/position/list?${queryString}`, headers);
        const data = response.data;
        if (data.retCode === 0 && data.result?.list) {
          const active = data.result.list.filter(p => parseFloat(p.size || '0') > 0);
          positions.push(...active);
        }
      } catch (err) {
        console.error(`Error fetching positions for ${item.category}:`, err.message);
      }
    }

    res.json({ success: true, positions });
  } catch (error) {
    console.error('Bybit Positions Serverless Error:', error.message);
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

// Route to fetch Bybit closed PnL (trade history) securely
app.post('/api/bybit/closed-pnl', bybitLimiter, async (req, res) => {
  const apiKey = process.env.BYBIT_API_KEY || req.body.apiKey;
  const apiSecret = process.env.BYBIT_API_SECRET || req.body.apiSecret;

  if (!apiKey || !apiSecret || apiKey === 'dummy' || apiKey === 'mock') {
    return res.json({ success: true, history: [] });
  }

  const categories = ['linear', 'inverse'];
  const history = [];
  const recvWindow = '5000';

  try {
    for (const category of categories) {
      const timestamp = Date.now().toString();
      const queryString = `category=${category}&limit=100`;

      const signature = generateBybitSignature(apiKey, apiSecret, timestamp, recvWindow, queryString);
      const headers = {
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-TIMESTAMP': timestamp,
        'X-BAPI-RECV-WINDOW': recvWindow,
        'X-BAPI-SIGN': signature,
      };

      try {
        const response = await callBybit(`/v5/position/closed-pnl?${queryString}`, headers);
        const data = response.data;
        if (data.retCode === 0 && data.result?.list) {
          history.push(...data.result.list);
        }
      } catch (err) {
        console.error(`Error fetching closed PnL for ${category}:`, err.message);
      }
    }

    history.sort((a, b) => parseInt(b.createdTime || '0') - parseInt(a.createdTime || '0'));
    res.json({ success: true, history });
  } catch (error) {
    console.error('Bybit Closed PnL Serverless Error:', error.message);
    res.status(500).json({ success: false, error: sanitizeError(error.message) });
  }
});

export default app;
