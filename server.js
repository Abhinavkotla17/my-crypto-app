import express from "express";

const app = express();
const PORT = 8787;
const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const getMarkPrice = (ticker) => {
  const bid = toNumber(ticker?.bid);
  const ask = toNumber(ticker?.ask);
  if (bid && ask && bid > 0 && ask > 0) {
    return (bid + ask) / 2;
  }

  return toNumber(ticker?.last_price ?? ticker?.price ?? ticker?.c);
};

// Simple CORS
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.get("/health", (req, res) => res.json({ ok: true }));

// ===== CoinDCX endpoints (server-side fetch avoids browser CORS) =====

// Futures pairs list
app.get("/api/futures/pairs", async (req, res) => {
  try {
    const url = "https://public.coindcx.com/market_data/v3/market_pairs/futures";
    const r = await fetch(url);
    const j = await r.json();
    res.json(j);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Futures prices (rt)
app.get("/api/futures/prices", async (req, res) => {
  try {
    const url = "https://public.coindcx.com/market_data/v3/current_prices/futures/rt";
    const r = await fetch(url);
    const j = await r.json();
    res.json(j);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Futures candlesticks
app.get("/api/futures/candles", async (req, res) => {
  try {
    const { pair, from, to, resolution, pcode } = req.query;
    if (!pair || !from || !to || !resolution) {
      return res.status(400).json({ error: "Missing query params: pair, from, to, resolution" });
    }
    const url = new URL("https://public.coindcx.com/market_data/candlesticks");
    url.searchParams.set("pair", pair);
    url.searchParams.set("from", from);
    url.searchParams.set("to", to);
    url.searchParams.set("resolution", resolution);
    url.searchParams.set("pcode", pcode || "f");

    const r = await fetch(url.toString());
    const j = await r.json();
    res.json(j);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Spot ticker
app.get("/api/spot/ticker", async (req, res) => {
  try {
    const url = "https://api.coindcx.com/exchange/ticker";
    const r = await fetch(url, { cache: "no-store" });
    const j = await r.json();
    const enriched = Array.isArray(j)
      ? j.map((ticker) => ({
          ...ticker,
          mark_price: getMarkPrice(ticker),
        }))
      : j;
    res.json(enriched);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Spot markets list
app.get("/api/spot/pairs", async (req, res) => {
  try {
    const url = "https://api.coindcx.com/exchange/v1/markets_details";
    const r = await fetch(url);
    const j = await r.json();
    res.json(j);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Spot candles
app.get("/api/spot/candles", async (req, res) => {
  try {
    const { pair, interval, limit } = req.query;
    if (!pair || !interval || !limit) {
      return res.status(400).json({ error: "Missing query params: pair, interval, limit" });
    }
    const url = new URL("https://public.coindcx.com/market_data/candles/");
    url.searchParams.set("pair", pair);
    url.searchParams.set("interval", interval);
    url.searchParams.set("limit", String(limit));

    const r = await fetch(url.toString());
    const j = await r.json();
    res.json(j);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.listen(PORT, () => {
  console.log(`Proxy server running: http://localhost:${PORT}`);
});
