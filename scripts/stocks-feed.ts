// Feeds the four tiles on the Pulse STOCKS board. Runs with Bun, no dependencies.
//
// API budget per run: Finnhub 11 calls (limit 60/min), Twelve Data 6 credits
// (limit 8/min, 800/day -> every 15 min = 576/day).
//
// Env:
//   FINNHUB_API_KEY, TWELVEDATA_API_KEY
//   PULSE_URL                                   e.g. https://pulse.lola.farm
//   PULSE_WATCHLIST_TILE  / PULSE_WATCHLIST_TOKEN
//   PULSE_FEATURED_TILE   / PULSE_FEATURED_TOKEN
//   PULSE_PORTFOLIO_TILE  / PULSE_PORTFOLIO_TOKEN
//   PULSE_NEWS_TILE       / PULSE_NEWS_TOKEN
// Any tile whose id/token is missing is skipped, so you can wire them up one at a time.
//
// This repo is public and its Actions logs are public. Logs and errors name a
// status code and, for Pulse, a tile id. They never include an API key, a tile
// token, a request URL, or a response body.

// ---- Your settings ---------------------------------------------------------

const STOCKS = [
  { symbol: "AAPL", name: "Apple" },
  { symbol: "MSFT", name: "Microsoft" },
  { symbol: "NVDA", name: "Nvidia" },
  { symbol: "TSLA", name: "Tesla" },
  { symbol: "AMZN", name: "Amazon" },
];
const CRYPTO = { symbol: "BTC", name: "Bitcoin", twelveData: "BTC/USD" };
const FEATURED = "NVDA";

// Made-up demo portfolio: number of shares / coins held.
const HOLDINGS: Record<string, number> = {
  AAPL: 30,
  MSFT: 10,
  NVDA: 40,
  TSLA: 8,
  AMZN: 25,
  BTC: 0.05,
};

// ---- Helpers ---------------------------------------------------------------

const env = (k: string) => process.env[k]?.trim() ?? "";
const need = (k: string) => {
  const v = env(k);
  if (!v) throw new Error(`Missing env ${k}`);
  return v;
};
const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

async function discard(res: Response) {
  await res.body?.cancel().catch(() => {});
}

async function getJson<T>(url: string, api: string, headers: Record<string, string> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch {
    throw new Error(`${api} network`);
  }
  if (!res.ok) {
    await discard(res);
    throw new Error(`${api} ${res.status}`);
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new Error(`${api} ${res.status}`);
  }
}

// ---- Finnhub: live quotes and news -----------------------------------------

const FH = "https://finnhub.io/api/v1";
const fhHeaders = () => ({ "X-Finnhub-Token": need("FINNHUB_API_KEY") });

type FhQuote = { c: number; d: number; dp: number; pc: number };
const quote = (symbol: string) =>
  getJson<FhQuote>(`${FH}/quote?symbol=${encodeURIComponent(symbol)}`, "Finnhub", fhHeaders());

type FhNews = { headline: string; source: string; datetime: number; related?: string };

async function news() {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const to = new Date();
  const from = new Date(Date.now() - 3 * 86_400_000);
  const perStock = await Promise.all(
    STOCKS.map(async ({ symbol }) => {
      const items = await getJson<FhNews[]>(
        `${FH}/company-news?symbol=${encodeURIComponent(symbol)}&from=${day(from)}&to=${day(to)}`,
        "Finnhub",
        fhHeaders(),
      ).catch(() => []);
      const list = Array.isArray(items) ? items : [];
      return list.slice(0, 5).map((n) => ({ ...n, symbol }));
    }),
  );
  const cryptoRaw = await getJson<FhNews[]>(`${FH}/news?category=crypto`, "Finnhub", fhHeaders()).catch(() => []);
  const crypto = (Array.isArray(cryptoRaw) ? cryptoRaw : [])
    .slice(0, 5)
    .map((n) => ({ ...n, symbol: CRYPTO.symbol }));

  const seen = new Set<string>();
  return [...perStock.flat(), ...crypto]
    .filter((n) => n.headline && !seen.has(n.headline) && seen.add(n.headline))
    .sort((a, b) => b.datetime - a.datetime)
    .slice(0, 12)
    .map((n) => ({
      headline: n.headline,
      source: n.source,
      symbol: n.symbol,
      publishedAt: new Date(n.datetime * 1000).toISOString(),
    }));
}

// ---- Twelve Data: intraday price history (one batched call) -----------------

type TdSeries = { status?: string; values?: { datetime: string; close: string }[] };
type Point = { t: string; price: number };

async function history(): Promise<Record<string, Point[]>> {
  const symbols = [...STOCKS.map((s) => s.symbol), CRYPTO.twelveData];
  const url =
    `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbols.join(","))}` +
    `&interval=15min&outputsize=96&timezone=UTC&apikey=${need("TWELVEDATA_API_KEY")}`;
  const res = await getJson<Record<string, TdSeries>>(url, "Twelve Data");
  const out: Record<string, Point[]> = {};
  for (const [key, series] of Object.entries(res)) {
    if (!series || typeof series !== "object" || series.status === "error" || !Array.isArray(series.values)) {
      if (/^[A-Z0-9./-]{1,20}$/.test(key)) console.warn(`No history for ${key}`);
      continue;
    }
    const symbol = key === CRYPTO.twelveData ? CRYPTO.symbol : key;
    out[symbol] = series.values
      .map((v) => ({ t: v.datetime.replace(" ", "T") + "Z", price: round(Number(v.close)) }))
      .filter((p) => Number.isFinite(p.price))
      .reverse(); // oldest first
  }
  return out;
}

// Stocks: keep only the latest trading day. Crypto: keep the whole 24h window.
function latestSession(points: Point[]) {
  if (!points.length) return points;
  const lastDay = points[points.length - 1].t.slice(0, 10);
  return points.filter((p) => p.t.startsWith(lastDay));
}

// ---- Pulse -----------------------------------------------------------------

async function pushToPulse(tile: string, token: string, body: unknown) {
  const res = await fetch(`${need("PULSE_URL").replace(/\/$/, "")}/api/widget-data/${tile}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    await discard(res);
    throw new Error(`Pulse ${res.status} for tile ${tile}`);
  }
  await discard(res);
  console.log(`Pushed tile ${tile}`);
}

async function push(name: string, body: unknown) {
  const tile = env(`PULSE_${name}_TILE`);
  const token = env(`PULSE_${name}_TOKEN`);
  if (!tile || !token) {
    console.log(`Skipping ${name}: no tile id/token set`);
    return;
  }
  await pushToPulse(tile, token, body);
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/^Missing env [A-Z0-9_]+$/.test(message)) return message;
  if (/^(Finnhub|Twelve Data) (\d{3}|network)$/.test(message)) return message;
  if (/^Pulse \d{3} for tile \d+$/.test(message)) return message;
  return "Stocks feed failed";
}

// ---- Build and send --------------------------------------------------------

try {
  const [quotes, series, articles] = await Promise.all([
    Promise.all(STOCKS.map((s) => quote(s.symbol))),
    history(),
    news(),
  ]);

  type Row = { symbol: string; name: string; price: number; prev: number; spark: Point[] };
  const rows: Row[] = STOCKS.map((s, i) => ({
    symbol: s.symbol,
    name: s.name,
    price: quotes[i].c,
    prev: quotes[i].pc,
    spark: latestSession(series[s.symbol] ?? []),
  }));

  const btcPts = series[CRYPTO.symbol] ?? [];
  if (btcPts.length) {
    rows.push({
      symbol: CRYPTO.symbol,
      name: CRYPTO.name,
      price: btcPts[btcPts.length - 1].price,
      prev: btcPts[0].price, // 24h ago
      spark: btcPts,
    });
  }

  const pct = (r: Row) => (r.prev ? ((r.price - r.prev) / r.prev) * 100 : 0);

  // 1. Watchlist
  await push("WATCHLIST", {
    currency: "USD",
    symbols: rows.map((r) => ({
      symbol: r.symbol,
      name: r.name,
      price: round(r.price),
      changePct: round(pct(r)),
      spark: r.spark.map((p) => p.price),
    })),
  });

  // 2. Featured stock
  const f = rows.find((r) => r.symbol === FEATURED);
  if (f) {
    await push("FEATURED", {
      symbol: f.symbol,
      name: f.name,
      currency: "USD",
      price: round(f.price),
      previousClose: round(f.prev),
      points: f.spark,
    });
  }

  // 3. Portfolio
  const holdings = rows
    .filter((r) => HOLDINGS[r.symbol])
    .map((r) => ({
      symbol: r.symbol,
      value: HOLDINGS[r.symbol] * r.price,
      change: HOLDINGS[r.symbol] * (r.price - r.prev),
    }));
  const total = holdings.reduce((s, h) => s + h.value, 0);
  const dayChange = holdings.reduce((s, h) => s + h.change, 0);
  await push("PORTFOLIO", {
    currency: "USD",
    totalValue: round(total),
    dayChange: round(dayChange),
    dayChangePct: total - dayChange ? round((dayChange / (total - dayChange)) * 100) : 0,
    holdings: holdings.map((h) => ({ symbol: h.symbol, value: round(h.value) })),
  });

  // 4. News
  await push("NEWS", { articles });
} catch (error) {
  console.error(safeError(error));
  process.exit(1);
}
