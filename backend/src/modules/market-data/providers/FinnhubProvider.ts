import { MarketDataProvider, Quote, HistoricalQuote, SearchResult } from '../MarketDataService';

const RATE_LIMIT_DELAY_MS = 1100; // Finnhub free tier: 60 calls/min → ~1 call/sec

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class FinnhubProvider implements MarketDataProvider {
  private apiKey: string;
  private baseUrl = 'https://finnhub.io/api/v1';
  private lastCallTime = 0;

  constructor() {
    this.apiKey = process.env.FINNHUB_API_KEY || '';
    if (!this.apiKey) {
      console.error('[FinnhubProvider] FINNHUB_API_KEY is not set. All API calls will fail.');
    }
  }

  /**
   * Enforce rate limiting: wait if last call was too recent.
   */
  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastCallTime;
    if (elapsed < RATE_LIMIT_DELAY_MS) {
      await delay(RATE_LIMIT_DELAY_MS - elapsed);
    }
    this.lastCallTime = Date.now();
  }

  /**
   * Fetch quotes for multiple symbols. Uses the /quote endpoint for price
   * and fetches today's candle for real volume data.
   */
  async getQuotes(symbols: string[]): Promise<Quote[]> {
    const quotes: Quote[] = [];

    for (const symbol of symbols) {
      try {
        await this.rateLimit();

        const response = await fetch(
          `${this.baseUrl}/quote?symbol=${encodeURIComponent(symbol)}&token=${this.apiKey}`
        );

        if (!response.ok) {
          console.error(`[FinnhubProvider] Quote failed for ${symbol}: ${response.status} ${response.statusText}`);
          continue;
        }

        const data = await response.json();

        // data.c = current price, data.t = timestamp (unix)
        // data.d = change, data.dp = percent change
        if (!data.c || data.c === 0) {
          console.warn(`[FinnhubProvider] No price data for ${symbol}, skipping`);
          continue;
        }

        // Fetch real volume from today's candle
        let volume = 0;
        try {
          volume = await this.fetchTodayVolume(symbol);
        } catch {
          // Fall back to 0 volume if candle fetch fails
          console.warn(`[FinnhubProvider] Could not fetch volume for ${symbol}, using 0`);
        }

        quotes.push({
          symbol,
          price: data.c,
          volume,
          ts: data.t ? new Date(data.t * 1000).toISOString() : new Date().toISOString(),
          source: 'finnhub',
        });
      } catch (err) {
        console.error(`[FinnhubProvider] Error fetching quote for ${symbol}:`, err);
      }
    }

    return quotes;
  }

  /**
   * Fetch today's trading volume from the candle endpoint.
   */
  private async fetchTodayVolume(symbol: string): Promise<number> {
    await this.rateLimit();

    const to = Math.floor(Date.now() / 1000);
    const from = to - 86400; // 24 hours ago

    const response = await fetch(
      `${this.baseUrl}/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${from}&to=${to}&token=${this.apiKey}`
    );

    if (!response.ok) return 0;

    const data = await response.json();
    if (data.s === 'no_data' || !data.v || data.v.length === 0) return 0;

    // Return the most recent volume
    return data.v[data.v.length - 1] || 0;
  }

  /**
   * Fetch historical daily candles for a symbol.
   */
  async getHistory(symbol: string, days: number): Promise<HistoricalQuote[]> {
    await this.rateLimit();

    const to = Math.floor(Date.now() / 1000);
    const from = to - days * 86400;

    try {
      const response = await fetch(
        `${this.baseUrl}/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${from}&to=${to}&token=${this.apiKey}`
      );

      if (!response.ok) {
        console.error(`[FinnhubProvider] History failed for ${symbol}: ${response.status}`);
        return [];
      }

      const data = await response.json();
      if (data.s === 'no_data' || !data.t) return [];

      const history: HistoricalQuote[] = [];
      for (let i = 0; i < data.t.length; i++) {
        history.push({
          date: new Date(data.t[i] * 1000).toISOString().split('T')[0],
          close: data.c[i],
          volume: data.v[i],
        });
      }

      return history;
    } catch (err) {
      console.error(`[FinnhubProvider] Error fetching history for ${symbol}:`, err);
      return [];
    }
  }

  /**
   * Search for symbols/companies via Finnhub symbol search.
   */
  async search(query: string): Promise<SearchResult[]> {
    await this.rateLimit();

    try {
      const response = await fetch(
        `${this.baseUrl}/search?q=${encodeURIComponent(query)}&token=${this.apiKey}`
      );

      if (!response.ok) {
        console.error(`[FinnhubProvider] Search failed: ${response.status}`);
        return [];
      }

      const data = await response.json();
      if (!data.result) return [];

      // Filter to common stocks without dots (e.g., exclude BRK.A)
      const results = data.result
        .filter((r: any) => r.type === 'Common Stock' && !r.symbol.includes('.'))
        .map((r: any) => ({
          symbol: r.symbol,
          name: r.description,
        }));

      // Deduplicate by symbol
      const seen = new Set<string>();
      const unique: SearchResult[] = [];
      for (const r of results) {
        if (!seen.has(r.symbol)) {
          seen.add(r.symbol);
          unique.push(r);
        }
      }

      return unique;
    } catch (err) {
      console.error('[FinnhubProvider] Search error:', err);
      return [];
    }
  }
}
