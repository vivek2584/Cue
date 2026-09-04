export interface Quote {
  symbol: string;
  price: number;
  volume: number;
  ts: string;        // ISO timestamp from the provider
  source: string;     // "finnhub" | "finnhub_ws" | ...
}

export interface HistoricalQuote {
  date: string;
  close: number;
  volume: number;
}

export interface SearchResult {
  symbol: string;
  name: string;
}

export interface MarketDataProvider {
  getQuotes(symbols: string[]): Promise<Quote[]>;
  getHistory(symbol: string, days: number): Promise<HistoricalQuote[]>;
  search(query: string): Promise<SearchResult[]>;
}

import { FinnhubProvider } from './providers/FinnhubProvider';

let instance: MarketDataService | null = null;

export class MarketDataService {
  private provider: MarketDataProvider;

  constructor() {
    const apiKey = process.env.FINNHUB_API_KEY;
    if (!apiKey) {
      console.error('[MarketDataService] FINNHUB_API_KEY is required but not set.');
    }
    this.provider = new FinnhubProvider();
  }

  /** Singleton accessor to avoid creating multiple provider instances. */
  static getInstance(): MarketDataService {
    if (!instance) {
      instance = new MarketDataService();
    }
    return instance;
  }

  async getQuotes(symbols: string[]): Promise<Quote[]> {
    return this.provider.getQuotes(symbols);
  }

  async getHistory(symbol: string, days: number): Promise<HistoricalQuote[]> {
    return this.provider.getHistory(symbol, days);
  }

  async search(query: string): Promise<SearchResult[]> {
    return this.provider.search(query);
  }
}
