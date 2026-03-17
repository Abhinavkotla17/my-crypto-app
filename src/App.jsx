import React, { useEffect, useMemo, useRef, useState } from "react";

/** * CONFIGURATION 
 */
const API_BASE = "http://localhost:8787";
const STORAGE_KEY = "strike_usdt_positions_v4";
const HISTORY_KEY = "strike_usdt_history_v4";
const PRICE_REFRESH_MS = 1000;
const CANDLE_REFRESH_MS = 5000;
const DEFAULT_USDT_INR = 88;
const CANDLE_HISTORY_LIMIT = 240;

// Precision formatting for USDT pairs
const formatPrice = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0.0000";
  return n.toLocaleString(undefined, { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 4 
  });
};

const formatPercent = (v) => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
const formatInr = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "₹0.00";
  return `₹${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const formatLivePnlInr = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "₹0.0000";
  const abs = Math.abs(n);
  const decimals = abs >= 100 ? 2 : abs >= 10 ? 3 : 4;
  const formatted = abs.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${n >= 0 ? "+" : "-"}₹${formatted}`;
};
const formatLivePnlUsdt = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0.000000 USDT";
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 6 });
  return `${n >= 0 ? "+" : "-"}${formatted} USDT`;
};
const formatElapsed = (startTs, nowTs) => {
  const start = Number(startTs);
  const now = Number(nowTs);
  if (!Number.isFinite(start) || !Number.isFinite(now) || now < start) return "00:00:00";
  const totalSeconds = Math.floor((now - start) / 1000);
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
};
const normalizeStoredPositions = (value) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, position]) => {
    if (!position || typeof position !== "object") return [];
    return [{ id: `${key}-${position.side || "POS"}-${position.ts || Date.now()}`, key, ...position }];
  });
};
const buildThunderGeometry = (lengthScale = 1) => {
  const clampedScale = Math.max(0.7, Math.min(1.8, Number(lengthScale) || 1));
  const pointCount = 4 + Math.floor(clampedScale * 3) + Math.floor(Math.random() * 2);
  const points = [{ x: 60 + (Math.random() * 8 - 4), y: 8 }];
  let currentX = points[0].x;
  let currentY = 8;

  for (let index = 0; index < pointCount; index += 1) {
    currentY += (24 + Math.random() * 28) * clampedScale;
    currentX += (Math.random() * 34) - 17;
    currentX = Math.max(24, Math.min(96, currentX));
    points.push({ x: currentX, y: Math.min(292, currentY) });
    if (currentY >= 292) break;
  }

  const branches = points.slice(1, -1).flatMap((point, index) => {
    if (Math.random() < 0.45) return [];
    const direction = index % 2 === 0 ? -1 : 1;
    const branchLength = (12 + Math.random() * 18) * Math.min(1.35, clampedScale);
    const branchDrop = (10 + Math.random() * 16) * Math.min(1.25, clampedScale);
    return [{
      x1: point.x,
      y1: point.y,
      x2: point.x + direction * branchLength,
      y2: Math.min(296, point.y + branchDrop),
    }];
  });

  const mainPath = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");

  return { mainPath, branches };
};
const toUpperString = (value) => (value ? String(value).toUpperCase() : "");
const uniqueValues = (values) => [...new Set(values.filter(Boolean))];
const buildCandlePairCandidates = (market, fallbackKey) => {
  const key = toUpperString(market?.key || fallbackKey);
  const base = key.endsWith("USDT") ? key.slice(0, -4) : "";

  return uniqueValues([
    toUpperString(market?.pair),
    toUpperString(market?.coindcxName),
    toUpperString(market?.symbol),
    toUpperString(market?.market),
    key,
    base ? `I-${base}_USDT` : "",
    base ? `B-${base}_USDT` : "",
  ]);
};

/**
 * PREDICTIVE LOGIC ENGINE
 */
const getCandleAnalysis = (candle, prevCandle) => {
  if (!candle) return { pattern: "--", impact: "NEUTRAL", color: "text-slate-500" };
  
  const body = Math.abs(candle[4] - candle[1]);
  const range = candle[2] - candle[3] || 0.0001;
  const isUp = candle[4] > candle[1];
  const upperWick = candle[2] - Math.max(candle[1], candle[4]);
  const lowerWick = Math.min(candle[1], candle[4]) - candle[3];
  
  const gap = prevCandle ? candle[1] - prevCandle[4] : 0;
  const gapPct = prevCandle ? (gap / prevCandle[4]) * 100 : 0;

  // Pattern detection logic
  if (upperWick > body * 2) return { pattern: "STAR", impact: "REVERSAL DOWN", color: "text-rose-500", gap, gapPct };
  if (lowerWick > body * 2) return { pattern: "HAMMER", impact: "REVERSAL UP", color: "text-emerald-500", gap, gapPct };
  if (body / range > 0.85) return { pattern: "MARUBOZU", impact: "CONTINUE", color: isUp ? "text-emerald-400" : "text-rose-400", gap, gapPct };
  
  return { pattern: isUp ? "BULLISH" : "BEARISH", impact: "STABLE", color: isUp ? "text-emerald-400" : "text-rose-400", gap, gapPct };
};

export default function StrikeTerminal() {
  const [markets, setMarkets] = useState([]);
  const [priceMap, setPriceMap] = useState({ spot: {} });
  const [candleMap, setCandleMap] = useState({});
  const [selectedKey, setSelectedKey] = useState("BTCUSDT");
  const [searchTerm, setSearchTerm] = useState("");
  const [lastTapePrice, setLastTapePrice] = useState(null);
  const [thunderBursts, setThunderBursts] = useState([]);
  const [meteoroids, setMeteoroids] = useState([]);
  const [candleGasBursts, setCandleGasBursts] = useState([]);
  const [starField] = useState(() => (
    Array.from({ length: 120 }, (_, index) => ({
      id: `star-${index}`,
      left: 2 + Math.random() * 96,
      top: 2 + Math.random() * 96,
      size: 1 + Math.random() * 2.6,
      delay: Math.random() * 3.4,
      duration: 1.8 + Math.random() * 3.6,
      spread: 6 + Math.random() * 18,
    }))
  ));
  
  // Trading States
  const [leverage, setLeverage] = useState(10);
  const [margin, setMargin] = useState(100);
  const [positions, setPositions] = useState(() => normalizeStoredPositions(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]")));
  const [history, setHistory] = useState(() => JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"));
  const [clock, setClock] = useState(Date.now());
  const [thunderSoundEnabled, setThunderSoundEnabled] = useState(false);
  const audioContextRef = useRef(null);
  const thunderNoiseBufferRef = useRef(null);
  const thunderSoundEnabledRef = useRef(false);
  const lastGasBucketRef = useRef(null);
  const lastConfirmedCandleTsRef = useRef(null);

  // 1. Initial Sync & Market Fetch
  useEffect(() => {
    const fetchMarkets = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/spot/pairs`, { cache: "no-store" });
        const data = await res.json();
        const list = Array.isArray(data) ? data : data.data || [];
        // Strictly filter for USDT markets as requested
        setMarkets(list.map(i => ({
                        key: toUpperString(i.symbol || i.market),
                        pair: toUpperString(i.pair),
                        market: toUpperString(i.market),
                        symbol: toUpperString(i.symbol),
                        coindcxName: toUpperString(i.coindcx_name)
                      }))
                      .filter(m => m.key.endsWith("USDT")));
      } catch (e) { console.error("Market Fetch Failed"); }
    };
    fetchMarkets();
  }, []);

  const filtered = useMemo(() => 
    markets.filter(m => m.key.includes(searchTerm.toUpperCase())).slice(0, 10), 
  [markets, searchTerm]);
  const usdtInrRate = priceMap.spot.USDTINR || DEFAULT_USDT_INR;
  const selectedMarket = useMemo(
    () => markets.find((market) => market.key === selectedKey) || null,
    [markets, selectedKey]
  );
  const selectedCandlePairs = useMemo(
    () => buildCandlePairCandidates(selectedMarket, selectedKey),
    [selectedMarket, selectedKey]
  );

  // 2. Continuous Ticker Loop
  useEffect(() => {
    const syncPrices = async () => {
      try {
        const pRes = await fetch(`${API_BASE}/api/spot/ticker`, { cache: "no-store" });
        const pData = await pRes.json();
        const nextPrices = {};
        (Array.isArray(pData) ? pData : Object.values(pData)).forEach(i => {
          const marketKey = (i.market || i.symbol || i.s || "").toUpperCase();
          const bid = Number(i.bid);
          const ask = Number(i.ask);
          const midpoint = Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0
            ? (bid + ask) / 2
            : null;
          const markPrice = Number(i.mark_price);
          nextPrices[marketKey] = Number.isFinite(markPrice) && markPrice > 0
            ? markPrice
            : Number.isFinite(midpoint) && midpoint > 0
              ? midpoint
              : Number(i.last_price || i.price || i.c);
        });
        setPriceMap({ spot: nextPrices });
      } catch (e) { console.error("Data Sync Error"); }
    };

    const timer = setInterval(syncPrices, PRICE_REFRESH_MS);
    syncPrices();
    return () => clearInterval(timer);
  }, []);

  // 3. Selected Candle Sync
  useEffect(() => {
    if (!selectedKey) return undefined;

    const syncCandles = async () => {
      let rows = [];

      try {
        for (const pairCode of selectedCandlePairs) {
          const cRes = await fetch(`${API_BASE}/api/spot/candles?pair=${encodeURIComponent(pairCode)}&interval=1m&limit=${CANDLE_HISTORY_LIMIT}`, { cache: "no-store" });
          const cData = await cRes.json();
          const nextRows = Array.isArray(cData) ? cData : cData.data || [];
          if (nextRows.length > rows.length) {
            rows = nextRows;
          }
          if (nextRows.length >= CANDLE_HISTORY_LIMIT) break;
        }

        setCandleMap(prev => ({ ...prev, [selectedKey]: [...rows].reverse() }));
      } catch (e) { console.error("Candle Sync Error"); }
    };

    const timer = setInterval(syncCandles, CANDLE_REFRESH_MS);
    syncCandles();
    return () => clearInterval(timer);
  }, [selectedCandlePairs, selectedKey]);

  // Persistence
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(positions)); }, [positions]);
  useEffect(() => { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); }, [history]);
  useEffect(() => {
    thunderSoundEnabledRef.current = thunderSoundEnabled;
  }, [thunderSoundEnabled]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Execution Functions
  const openPosition = (side) => {
    const price = priceMap.spot[selectedKey];
    if (!price || !usdtInrRate) return;
    const marginInr = Number(margin);
    const leverageValue = Number(leverage);
    const sizeUsdt = (marginInr * leverageValue) / usdtInrRate;
    setPositions(prev => ([
      ...prev,
      {
        id: `${selectedKey}-${side}-${Date.now()}`,
        key: selectedKey,
        side,
        entry: price,
        marginInr,
        leverage: leverageValue,
        usdtInrRate,
        qty: sizeUsdt / price,
        ts: Date.now()
      }
    ]));
  };

  const closePosition = (positionId) => {
    const pos = positions.find((position) => position.id === positionId);
    if (!pos) return;
    const cur = Number(priceMap.spot[pos.key]);
    if (!Number.isFinite(cur) || cur <= 0) return;
    const pnlUsdt = pos.side === "LONG" ? (cur - pos.entry) * pos.qty : (pos.entry - cur) * pos.qty;
    const closeRate = priceMap.spot.USDTINR || pos.usdtInrRate || DEFAULT_USDT_INR;
    const pnlInr = pnlUsdt * closeRate;
    setHistory(prev => [{ ...pos, closePrice: cur, pnlInr, closedAt: Date.now() }, ...prev]);
    setPositions(prev => prev.filter((position) => position.id !== positionId));
  };
  const getAudioContext = () => {
    if (typeof window === "undefined") return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioCtx();
    }
    return audioContextRef.current;
  };
  const getThunderNoiseBuffer = (ctx) => {
    if (!ctx) return null;
    if (thunderNoiseBufferRef.current) return thunderNoiseBufferRef.current;

    const buffer = ctx.createBuffer(1, ctx.sampleRate * 1.2, ctx.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < channel.length; i += 1) {
      channel[i] = (Math.random() * 2 - 1) * (1 - i / channel.length);
    }
    thunderNoiseBufferRef.current = buffer;
    return buffer;
  };
  const playThunderSound = (intensity, side, force = false) => {
    if (typeof window === "undefined" || (!force && !thunderSoundEnabledRef.current)) return;

    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;
    const thunderDuration = 0.9 + intensity * 2.2;
    const crackDuration = 0.08 + intensity * 0.05;
    const tailFadeTime = now + thunderDuration;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.0001, now);
    masterGain.gain.exponentialRampToValueAtTime(0.14 + intensity * 0.18, now + 0.02);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, tailFadeTime);
    masterGain.connect(ctx.destination);

    const noiseSource = ctx.createBufferSource();
    const noiseFilter = ctx.createBiquadFilter();
    const noiseBand = ctx.createBiquadFilter();
    const noiseGain = ctx.createGain();
    noiseSource.buffer = getThunderNoiseBuffer(ctx);
    noiseFilter.type = "lowpass";
    noiseFilter.frequency.setValueAtTime(side === "BUY" ? 900 : 760, now);
    noiseFilter.frequency.exponentialRampToValueAtTime(side === "BUY" ? 180 : 140, now + 1.1);
    noiseBand.type = "bandpass";
    noiseBand.frequency.setValueAtTime(side === "BUY" ? 160 : 130, now);
    noiseBand.Q.setValueAtTime(0.45, now);
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.95 + intensity * 0.45, now + 0.04);
    noiseGain.gain.exponentialRampToValueAtTime(0.22 + intensity * 0.08, now + 0.38 + intensity * 0.22);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, tailFadeTime - 0.05);
    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseBand);
    noiseBand.connect(noiseGain);
    noiseGain.connect(masterGain);

    const rumble = ctx.createOscillator();
    const rumbleFilter = ctx.createBiquadFilter();
    const rumbleGain = ctx.createGain();
    rumble.type = "triangle";
    rumble.frequency.setValueAtTime(side === "BUY" ? 58 : 42, now);
    rumble.frequency.exponentialRampToValueAtTime(side === "BUY" ? 24 : 19, now + 1.1);
    rumbleFilter.type = "lowpass";
    rumbleFilter.frequency.setValueAtTime(220, now);
    rumbleGain.gain.setValueAtTime(0.0001, now);
    rumbleGain.gain.exponentialRampToValueAtTime(0.3 + intensity * 0.16, now + 0.06);
    rumbleGain.gain.exponentialRampToValueAtTime(0.08 + intensity * 0.04, now + thunderDuration * 0.52);
    rumbleGain.gain.exponentialRampToValueAtTime(0.0001, tailFadeTime);
    rumble.connect(rumbleFilter);
    rumbleFilter.connect(rumbleGain);
    rumbleGain.connect(masterGain);

    const crack = ctx.createOscillator();
    const crackGain = ctx.createGain();
    crack.type = "square";
    crack.frequency.setValueAtTime(side === "BUY" ? 1200 : 980, now);
    crack.frequency.exponentialRampToValueAtTime(side === "BUY" ? 220 : 180, now + 0.05);
    crackGain.gain.setValueAtTime(0.0001, now);
    crackGain.gain.exponentialRampToValueAtTime(0.18 + intensity * 0.12, now + 0.006);
    crackGain.gain.exponentialRampToValueAtTime(0.0001, now + crackDuration);
    crack.connect(crackGain);
    crackGain.connect(masterGain);

    noiseSource.start(now);
    rumble.start(now);
    crack.start(now);
    noiseSource.stop(tailFadeTime);
    rumble.stop(tailFadeTime);
    crack.stop(now + crackDuration);
  };

  const livePrice = priceMap.spot[selectedKey] || 0;
  const rawCandles = candleMap[selectedKey] || [];
  const activeCandles = useMemo(() => {
    if (!rawCandles.length) return [];
    if (!Number.isFinite(livePrice) || livePrice <= 0) return rawCandles;

    const currentBucket = Math.floor(Date.now() / 60000) * 60000;
    const candles = [...rawCandles];
    const latest = candles[candles.length - 1];
    const latestTs = Number(latest?.[0] || 0);

    if (latestTs === currentBucket) {
      candles[candles.length - 1] = [
        currentBucket,
        Number(latest[1]),
        Math.max(Number(latest[2]), livePrice),
        Math.min(Number(latest[3]), livePrice),
        livePrice,
        Number(latest[5] || 0),
      ];
      return candles;
    }

    const baseOpen = Number(latest?.[4] || livePrice);
    return [...candles, [
      currentBucket,
      baseOpen,
      Math.max(baseOpen, livePrice),
      Math.min(baseOpen, livePrice),
      livePrice,
      0,
    ]].slice(-CANDLE_HISTORY_LIMIT);
  }, [livePrice, rawCandles]);
  const openPositions = useMemo(
    () => positions.map((position) => {
      const marketPrice = Number(priceMap.spot[position.key]);
      const markPrice = Number.isFinite(marketPrice) && marketPrice > 0
        ? marketPrice
        : Number(position.entry) || 0;
      const fxRate = priceMap.spot.USDTINR || position.usdtInrRate || DEFAULT_USDT_INR;
      const direction = position.side === "LONG" ? 1 : -1;
      const pnlUsdt = (markPrice - position.entry) * position.qty * direction;
      const pnlInr = pnlUsdt * fxRate;
      const pnlPercent = Number(position.marginInr) > 0
        ? (pnlInr / Number(position.marginInr)) * 100
        : 0;

      return {
        ...position,
        markPrice,
        pnlUsdt,
        pnlInr,
        pnlPercent,
        hasLivePrice: Number.isFinite(marketPrice) && marketPrice > 0,
      };
    }),
    [positions, priceMap.spot]
  );
  const candleTrackerSummary = useMemo(() => {
    const greenCount = activeCandles.filter((candle) => candle[4] > candle[1]).length;
    const redCount = activeCandles.filter((candle) => candle[4] < candle[1]).length;
    const neutralCount = activeCandles.length - greenCount - redCount;
    const difference = Math.abs(greenCount - redCount);
    const winner = greenCount > redCount
      ? "GREEN WON"
      : redCount > greenCount
        ? "RED WON"
        : "DRAW";

    return { greenCount, redCount, neutralCount, difference, winner };
  }, [activeCandles]);
  const totalHistoryPnl = useMemo(
    () => history.reduce((sum, trade) => sum + Number(trade?.pnlInr || 0), 0),
    [history]
  );
  const skyTone = useMemo(() => {
    const latestCandle = activeCandles[activeCandles.length - 1];
    const candleMove = latestCandle ? Number(latestCandle[4]) - Number(latestCandle[1]) : 0;
    const tickMove = Number.isFinite(lastTapePrice) && lastTapePrice > 0 ? livePrice - lastTapePrice : 0;
    const combinedMove = candleMove + tickMove;
    const direction = combinedMove > 0 ? "UP" : combinedMove < 0 ? "DOWN" : "FLAT";
    const strengthBase = latestCandle && Number(latestCandle[1]) > 0
      ? Math.abs(candleMove) / Number(latestCandle[1])
      : 0;
    const strength = Math.min(1, Math.max(0.12, strengthBase * 120 + Math.abs(tickMove) * 20));
    return { direction, strength };
  }, [activeCandles, lastTapePrice, livePrice]);

  useEffect(() => {
    setLastTapePrice(null);
    setThunderBursts([]);
    setMeteoroids([]);
    setCandleGasBursts([]);
    lastGasBucketRef.current = null;
    lastConfirmedCandleTsRef.current = null;
  }, [selectedKey]);

  useEffect(() => {
    const latestCandle = rawCandles[rawCandles.length - 1];
    if (!latestCandle) return;

    const bucket = Number(latestCandle[0] || 0);
    const candleOpen = Number(latestCandle[1] || 0);
    const candleClose = Number(latestCandle[4] || 0);
    if (!Number.isFinite(bucket) || !Number.isFinite(candleOpen) || candleOpen <= 0) return;

    const side = candleClose >= candleOpen ? "GREEN" : "RED";
    const moveStrength = Math.abs(candleClose - candleOpen) / candleOpen;
    const intensity = Math.min(1, Math.max(0.32, moveStrength * 260));
    const spawnGas = () => {
      lastGasBucketRef.current = bucket;
      const gasId = `${selectedKey}-gas-${bucket}`;
      const x = 18 + Math.random() * 64;
      const y = 12 + Math.random() * 48;

      setCandleGasBursts((prev) => [
        ...prev.slice(-1),
        { id: gasId, bucket, side, intensity, x, y },
      ]);

      window.setTimeout(() => {
        setCandleGasBursts((prev) => prev.filter((cloud) => cloud.id !== gasId));
      }, 22000);
    };

    if (lastConfirmedCandleTsRef.current === null) {
      lastConfirmedCandleTsRef.current = bucket;
      spawnGas();
      return;
    }
    if (lastConfirmedCandleTsRef.current === bucket) return;
    lastConfirmedCandleTsRef.current = bucket;
    spawnGas();
  }, [rawCandles, selectedKey]);

  useEffect(() => {
    if (!Number.isFinite(livePrice) || livePrice <= 0) return;

    if (!Number.isFinite(lastTapePrice) || lastTapePrice <= 0) {
      setLastTapePrice(livePrice);
      return;
    }

    const delta = livePrice - lastTapePrice;
    if (delta === 0) return;

    const pctMove = Math.abs(delta) / lastTapePrice;
    const latestVolume = Number(activeCandles[activeCandles.length - 1]?.[5] || 0);
    const previousVolumes = activeCandles
      .slice(-6, -1)
      .map((candle) => Number(candle?.[5] || 0))
      .filter((volume) => Number.isFinite(volume) && volume > 0);
    const baselineVolume = previousVolumes.length
      ? previousVolumes.reduce((sum, volume) => sum + volume, 0) / previousVolumes.length
      : latestVolume || 1;
    const volumePressure = baselineVolume > 0
      ? latestVolume / baselineVolume
      : 1;
    const intensity = Math.min(1, Math.max(0.25, pctMove * 700));
    const lengthScale = Math.min(1.8, Math.max(0.7, 0.85 + intensity * 0.55 + Math.min(1.1, volumePressure) * 0.45));
    const side = delta > 0 ? "BUY" : "SELL";
    const burstId = `${selectedKey}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const left = 10 + Math.random() * 76;
    const top = 8 + Math.random() * 48;
    const rotation = side === "BUY"
      ? -18 + Math.random() * 20
      : -2 + Math.random() * 20;

    const geometry = buildThunderGeometry(lengthScale);

    setThunderBursts((prev) => [
      ...prev.slice(-7),
      { id: burstId, side, intensity, left, top, rotation, lengthScale, ...geometry },
    ]);
    playThunderSound(intensity, side);

    if (side === "SELL") {
      const meteorId = `${selectedKey}-meteor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const startLeft = 64 + Math.random() * 28;
      const startTop = 6 + Math.random() * 18;
      const travelX = 120 + intensity * 120;
      const travelY = 150 + intensity * 170;
      const meteorSize = 7 + intensity * 10;
      const meteorDuration = 0.8 + intensity * 1.3;

      setMeteoroids((prev) => [
        ...prev.slice(-5),
        {
          id: meteorId,
          startLeft,
          startTop,
          travelX,
          travelY,
          size: meteorSize,
          duration: meteorDuration,
          tilt: 22 + Math.random() * 18,
        },
      ]);

      window.setTimeout(() => {
        setMeteoroids((prev) => prev.filter((meteor) => meteor.id !== meteorId));
      }, meteorDuration * 1000 + 120);
    }

    setLastTapePrice(livePrice);

    const cleanup = window.setTimeout(() => {
      setThunderBursts((prev) => prev.filter((burst) => burst.id !== burstId));
    }, 900);

    return () => window.clearTimeout(cleanup);
  }, [activeCandles, livePrice, lastTapePrice, selectedKey]);

  return (
    <div className="min-h-screen bg-black text-white font-mono p-4 lg:p-6 relative overflow-hidden">
      <style>{`
        @keyframes meteorFall {
          0% {
            opacity: 0;
            transform: translate3d(0, 0, 0) scale(0.82);
          }
          8% {
            opacity: 1;
          }
          100% {
            opacity: 0;
            transform: translate3d(var(--meteor-x), var(--meteor-y), 0) scale(1.08);
          }
        }
      `}</style>
      <div className="pointer-events-none absolute inset-0 z-20">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.04),transparent_35%)]" />
        <div className="absolute inset-0">
          {starField.map((star) => {
            const isUp = skyTone.direction === "UP";
            const isDown = skyTone.direction === "DOWN";
            const opacity = isUp
              ? 0.3 + skyTone.strength * 0.65
              : isDown
                ? 0.05 + (1 - skyTone.strength) * 0.18
                : 0.22;
            const glow = isUp
              ? `0 0 ${star.spread}px rgba(255,255,255,${0.35 + skyTone.strength * 0.55})`
              : `0 0 ${Math.max(4, star.spread * 0.45)}px rgba(255,255,255,${isDown ? 0.08 : 0.18})`;

            return (
              <div
                key={star.id}
                className="absolute rounded-full"
                style={{
                  left: `${star.left}%`,
                  top: `${star.top}%`,
                  width: `${star.size}px`,
                  height: `${star.size}px`,
                  background: "rgba(255,255,255,0.95)",
                  opacity,
                  boxShadow: glow,
                  animation: `pulse ${star.duration}s ease-in-out ${star.delay}s infinite`,
                }}
              />
            );
          })}
        </div>
        <div className="absolute inset-0">
          {candleGasBursts.map((cloud) => {
            const gasColor = cloud.side === "GREEN"
              ? `rgba(16,185,129,${0.12 + cloud.intensity * 0.18})`
              : `rgba(244,63,94,${0.12 + cloud.intensity * 0.18})`;
            const gasHighlight = cloud.side === "GREEN"
              ? `rgba(110,231,183,${0.1 + cloud.intensity * 0.18})`
              : `rgba(253,164,175,${0.1 + cloud.intensity * 0.18})`;

            return (
              <div
                key={cloud.id}
                className="absolute rounded-full blur-3xl animate-pulse"
                style={{
                  left: `${cloud.x}%`,
                  top: `${cloud.y}%`,
                  width: `${300 + cloud.intensity * 280}px`,
                  height: `${220 + cloud.intensity * 220}px`,
                  transform: "translate(-50%, -50%)",
                  background: `radial-gradient(circle, ${gasHighlight} 0%, ${gasColor} 28%, transparent 74%)`,
                  opacity: 0.62 + cloud.intensity * 0.3,
                }}
              />
            );
          })}
        </div>
        <div className="absolute inset-0">
          {meteoroids.map((meteor) => (
            <div
              key={meteor.id}
              className="absolute"
              style={{
                left: `${meteor.startLeft}%`,
                top: `${meteor.startTop}%`,
                ["--meteor-x"]: `-${meteor.travelX}px`,
                ["--meteor-y"]: `${meteor.travelY}px`,
                animation: `meteorFall ${meteor.duration}s linear forwards`,
                transform: `rotate(-${meteor.tilt}deg)`,
              }}
            >
              <div
                className="absolute rounded-full blur-2xl"
                style={{
                  width: `${meteor.size * 10}px`,
                  height: `${meteor.size * 2.8}px`,
                  right: `${meteor.size * 0.8}px`,
                  top: `${meteor.size * -0.45}px`,
                  background: "linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(82,24,24,0.18) 18%, rgba(120,53,15,0.38) 40%, rgba(249,115,22,0.78) 72%, rgba(255,243,176,0.94) 100%)",
                  transform: "translateX(10%)",
                }}
              />
              <div
                className="absolute rounded-full blur-xl"
                style={{
                  width: `${meteor.size * 7.2}px`,
                  height: `${meteor.size * 1.7}px`,
                  right: `${meteor.size * 1.5}px`,
                  top: `${meteor.size * -0.05}px`,
                  background: "linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(55,65,81,0.22) 12%, rgba(113,113,122,0.2) 26%, rgba(251,146,60,0.54) 70%, rgba(255,237,213,0.88) 100%)",
                }}
              />
              <div
                className="absolute rounded-full blur-lg"
                style={{
                  width: `${meteor.size * 3.2}px`,
                  height: `${meteor.size * 3.2}px`,
                  right: `${meteor.size * -0.15}px`,
                  top: `${meteor.size * -0.85}px`,
                  background: "radial-gradient(circle, rgba(255,244,214,0.88) 0%, rgba(249,115,22,0.72) 38%, rgba(220,38,38,0.32) 70%, rgba(0,0,0,0) 100%)",
                }}
              />
              <div
                className="absolute"
                style={{
                  width: `${meteor.size * 1.65}px`,
                  height: `${meteor.size * 1.35}px`,
                  right: "0",
                  top: `${meteor.size * 0.05}px`,
                  borderRadius: "42% 58% 56% 44% / 46% 42% 58% 54%",
                  background: "radial-gradient(circle at 32% 30%, rgba(255,255,255,0.18) 0%, rgba(120,113,108,0.96) 18%, rgba(68,64,60,0.98) 52%, rgba(28,25,23,0.98) 100%)",
                  border: "1px solid rgba(245,158,11,0.22)",
                  boxShadow: "0 0 12px rgba(249,115,22,0.34), inset -2px -3px 6px rgba(0,0,0,0.48)",
                }}
              >
                <div
                  className="absolute rounded-full"
                  style={{
                    width: `${meteor.size * 0.28}px`,
                    height: `${meteor.size * 0.22}px`,
                    left: `${meteor.size * 0.22}px`,
                    top: `${meteor.size * 0.18}px`,
                    background: "rgba(24,24,27,0.52)",
                  }}
                />
                <div
                  className="absolute rounded-full"
                  style={{
                    width: `${meteor.size * 0.18}px`,
                    height: `${meteor.size * 0.14}px`,
                    left: `${meteor.size * 0.72}px`,
                    top: `${meteor.size * 0.56}px`,
                    background: "rgba(24,24,27,0.46)",
                  }}
                />
                <div
                  className="absolute rounded-full blur-[2px]"
                  style={{
                    width: `${meteor.size * 0.5}px`,
                    height: `${meteor.size * 0.24}px`,
                    right: `${meteor.size * -0.08}px`,
                    top: `${meteor.size * 0.18}px`,
                    background: "linear-gradient(90deg, rgba(251,146,60,0.08) 0%, rgba(251,146,60,0.6) 60%, rgba(255,247,237,0.92) 100%)",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        {thunderBursts.map((burst) => {
          const glowColor = burst.side === "BUY"
            ? `rgba(16,185,129,${0.12 + burst.intensity * 0.24})`
            : `rgba(244,63,94,${0.12 + burst.intensity * 0.24})`;
          const boltColor = burst.side === "BUY"
            ? `rgba(16,185,129,${0.5 + burst.intensity * 0.45})`
            : `rgba(244,63,94,${0.5 + burst.intensity * 0.45})`;

          return (
            <div
              key={burst.id}
              className="absolute animate-pulse"
              style={{
                left: `${burst.left}%`,
                top: `${burst.top}%`,
                transform: `translate(-50%, 0) rotate(${burst.rotation}deg)`,
              }}
            >
              <div
                className="absolute blur-3xl rounded-full"
                style={{
                  background: `radial-gradient(circle, ${glowColor} 0%, transparent 70%)`,
                  width: `${180 + burst.intensity * 180}px`,
                  height: `${180 + burst.intensity * 180}px`,
                  left: "50%",
                  top: "14px",
                  transform: "translate(-50%, -30%)",
                }}
              />
              <svg
                width={Math.round(110 + burst.intensity * 40)}
                height={Math.round((220 + burst.intensity * 80) * (burst.lengthScale || 1))}
                viewBox="0 0 120 300"
                fill="none"
                style={{
                  overflow: "visible",
                  transform: `scaleY(${burst.lengthScale || 1})`,
                  transformOrigin: "top center",
                }}
              >
                <path
                  d={burst.mainPath || "M60 8 L48 72 L66 132 L44 196 L58 252 L40 294"}
                  stroke={boltColor}
                  strokeWidth={1.8 + burst.intensity * 1.1}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    filter: `drop-shadow(0 0 6px ${boltColor}) drop-shadow(0 0 14px ${boltColor})`,
                  }}
                />
                {(burst.branches || []).map((branch, index) => (
                  <path
                    key={`${burst.id}-branch-${index}`}
                    d={`M${branch.x1.toFixed(1)} ${branch.y1.toFixed(1)} L${branch.x2.toFixed(1)} ${branch.y2.toFixed(1)}`}
                    stroke={boltColor}
                    strokeWidth={0.7 + burst.intensity * 0.45}
                    strokeLinecap="round"
                    style={{
                      filter: `drop-shadow(0 0 5px ${boltColor})`,
                    }}
                  />
                ))}
              </svg>
            </div>
          );
        })}
      </div>

      <div className="max-w-[1500px] mx-auto space-y-4 relative z-10">
        
        {/* HEADER & SEARCH BAR */}
        <header className="flex flex-col md:flex-row justify-between items-center bg-[#0a0a0a] border border-white/5 p-4 rounded-3xl gap-4">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_10px_#10b981]" />
            <span className="font-black text-xs tracking-tighter uppercase text-emerald-500">Strike_USDT_Terminal</span>
          </div>
          <div className="flex w-full flex-col gap-3 md:w-auto md:flex-row md:items-center">
            <button
              type="button"
              onClick={() => {
                const nextEnabled = !thunderSoundEnabled;
                setThunderSoundEnabled(nextEnabled);
                const ctx = getAudioContext();
                ctx?.resume?.().catch(() => {});
                if (nextEnabled) {
                  window.setTimeout(() => {
                    playThunderSound(0.7, "BUY", true);
                  }, 40);
                }
              }}
              className={`rounded-xl border px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em] transition ${
                thunderSoundEnabled
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-white/10 bg-black text-white/50 hover:border-white/20 hover:text-white/80"
              }`}
            >
              Thunder Sound: {thunderSoundEnabled ? "On" : "Off"}
            </button>
            <div className="relative w-full md:w-96">
              <input 
                type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                placeholder="SEARCH USDT PAIR (BTC, SOL, ETH...)"
                className="w-full bg-black border border-white/10 px-5 py-3 rounded-xl text-xs focus:border-emerald-500 outline-none transition-all placeholder:text-white/20"
              />
              {searchTerm && (
                <div className="absolute top-full left-0 w-full bg-[#0d0d0d] border border-white/10 mt-2 rounded-xl z-50 overflow-hidden shadow-2xl">
                  {filtered.map(m => (
                    <div key={m.key} onClick={() => { setSelectedKey(m.key); setSearchTerm(""); }} className="p-4 hover:bg-emerald-500/10 cursor-pointer flex justify-between border-b border-white/5">
                      <span className="font-bold text-xs">{m.key}</span>
                      <span className="text-emerald-500 text-xs">${formatPrice(priceMap.spot[m.key])}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="grid lg:grid-cols-12 gap-4">
          {/* LEFT: TRADING PANEL */}
          <div className="lg:col-span-3 space-y-4">
            <div className="bg-[#0a0a0a] border border-white/5 p-6 rounded-[32px]">
              <div className="mb-8">
                <span className="text-[10px] text-white/30 font-bold uppercase tracking-widest">Live_Asset</span>
                <h2 className="text-3xl font-black text-emerald-400">{selectedKey}</h2>
                <div className="text-2xl font-bold tracking-tight mt-1">${formatPrice(livePrice)}</div>
              </div>

              <div className="space-y-6">
                <div>
                  <div className="flex justify-between text-[10px] text-white/30 uppercase mb-2">
                    <span>Leverage</span>
                    <span className="text-emerald-500">{leverage}x</span>
                  </div>
                  <input type="range" min="1" max="100" value={leverage} onChange={e => setLeverage(e.target.value)} className="w-full h-1 bg-white/10 accent-emerald-500 rounded-lg appearance-none cursor-pointer" />
                </div>
                <div>
                  <label className="text-[10px] text-white/30 block mb-2 uppercase">Margin (INR)</label>
                  <input type="number" value={margin} onChange={e => setMargin(e.target.value)} className="w-full bg-black border border-white/10 p-4 rounded-2xl text-sm font-bold outline-none focus:border-emerald-500" />
                </div>
                <div className="grid grid-cols-2 gap-4 pt-2">
                  <button onClick={() => openPosition("LONG")} className="bg-emerald-500 text-black py-4 rounded-2xl font-black text-[11px] hover:bg-emerald-400 transition-all active:scale-95">LONG</button>
                  <button onClick={() => openPosition("SHORT")} className="bg-white text-black py-4 rounded-2xl font-black text-[11px] hover:bg-slate-200 transition-all active:scale-95">SHORT</button>
                </div>
              </div>
            </div>

            {/* QUICK WATCHLIST */}
            <div className="bg-[#0a0a0a] border border-white/5 rounded-[32px] p-4">
              <span className="text-[9px] text-white/30 font-black uppercase mb-3 block px-2 tracking-widest">Watchlist</span>
              {markets.filter(m => ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"].includes(m.key)).map(k => (
                <div key={k.key} onClick={() => setSelectedKey(k.key)} className={`flex justify-between p-3 rounded-xl cursor-pointer transition-all ${selectedKey === k.key ? 'bg-emerald-500/10' : 'hover:bg-white/5'}`}>
                  <span className="text-xs font-bold text-white/60">{k.key.replace('USDT', '')}</span>
                  <span className="text-xs text-emerald-500 font-mono">${formatPrice(priceMap.spot[k.key])}</span>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT: ANALYSIS & POSITIONS */}
          <div className="lg:col-span-9 space-y-4">
            {/* LIVE P&L HUD */}
            {openPositions.length > 0 && (
              <div className="space-y-3">
                {openPositions.map((activePos) => {
                  return (
                    <div key={activePos.id} className={`${activePos.side === "LONG" ? "bg-emerald-500" : "bg-white"} text-black p-6 rounded-[32px] flex flex-col md:flex-row justify-between items-center shadow-[0_0_40px_rgba(16,185,129,0.15)]`}>
                      <div>
                        <div className="text-[10px] font-black uppercase opacity-60">Unrealized_Profit_Loss</div>
                        <div className="text-5xl font-black tracking-tighter">
                          {formatLivePnlInr(activePos.pnlInr)}
                        </div>
                        <div className="text-[10px] font-bold mt-1 opacity-60">
                          PAIR: {activePos.key} | SIDE: {activePos.side} | ENTRY: ${formatPrice(activePos.entry)} | LIVE: ${formatPrice(activePos.markPrice)}
                        </div>
                        <div className="text-[10px] font-bold mt-1 opacity-60">
                          PNL_USDT: {formatLivePnlUsdt(activePos.pnlUsdt)} | ROI: {formatPercent(activePos.pnlPercent)}
                        </div>
                        <div className="text-[10px] font-bold mt-1 opacity-60">
                          LEV: {activePos.leverage}x | MARGIN: {formatInr(activePos.marginInr)} | FEED: {activePos.hasLivePrice ? "LIVE" : "HOLDING ENTRY"}
                        </div>
                        <div className="text-[10px] font-bold mt-1 opacity-60">
                          LIVE_FOR: {formatElapsed(activePos.ts, clock)}
                        </div>
                      </div>
                      <button onClick={() => closePosition(activePos.id)} className="mt-4 md:mt-0 bg-black text-white px-10 py-4 rounded-full text-xs font-black uppercase tracking-widest hover:scale-105 transition-all">Close_Position</button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* HISTORY LEDGER */}
            <div className="bg-[#0a0a0a] border border-white/5 rounded-[32px] p-6">
              <div className="flex justify-between items-center mb-4">
                <span className="text-[10px] font-black text-white/30 uppercase tracking-widest">Session_History</span>
                <div className="text-right">
                  <div className="text-[10px] text-emerald-500 font-bold">TOTAL_TRADES: {history.length}</div>
                  <div className={`text-[10px] font-black ${totalHistoryPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    TOTAL_P&amp;L: {totalHistoryPnl >= 0 ? "+" : ""}{formatInr(totalHistoryPnl)}
                  </div>
                </div>
              </div>
              <div className="space-y-2 max-h-40 overflow-y-auto pr-2">
                {history.map((h, i) => (
                  <div key={i} className="flex justify-between items-center p-4 bg-white/[0.03] rounded-2xl border border-white/5">
                    <div className="text-[10px]">
                      <span className="font-bold text-white/80">{h.key}</span>
                      <span className="mx-2 opacity-30">|</span>
                      <span className={h.side === 'LONG' ? 'text-emerald-500' : 'text-rose-500'}>{h.side}</span>
                    </div>
                    <span className={`text-xs font-black ${h.pnlInr >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                      {h.pnlInr >= 0 ? '+' : ''}{formatInr(h.pnlInr)}
                    </span>
                  </div>
                ))}
                {history.length === 0 && <div className="text-center py-6 text-white/10 text-xs font-bold uppercase tracking-widest">No_History_Yet</div>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
