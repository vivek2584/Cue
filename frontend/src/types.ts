export type Bucket = 'needs_attention' | 'notable' | 'quiet';

export interface WatchlistItemView {
  id: string;
  symbol: string;
  name: string;
  price: number;
  baselinePrice: number; // Added so WS hook can calculate change
  changePct: number;
  changeAbs: number;
  signal: { bucket: Bucket; score: number; reason: string };
  sparkline: number[];
  lastViewedAt: string;
  addedAt: string;
  freshness: { asOf: string; isStale: boolean; ageSeconds: number };
}

export interface WatchlistResponse {
  items: WatchlistItemView[];
  digest: { items: WatchlistItemView[] };
}
