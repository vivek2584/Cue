import { computeAttentionScore, Bucket } from './attentionScore';

export interface WatchlistItemRaw {
  id: string;
  symbol: string;
  name: string;
  baselinePrice: number;
  addedAt: Date;
  lastViewedAt: Date;
  currentPrice: number;
  currentVolume: number;
  ts: string;
  isStale: boolean;
  stddevReturn30d: number;
  avgVolume30d: number;
  high52w: number;
  low52w: number;
  sparkline: number[];
}

export interface WatchlistItemView {
  id: string;
  symbol: string;
  name: string;
  price: number;
  changePct: number;
  changeAbs: number;
  signal: { bucket: Bucket; score: number; reason: string };
  sparkline: number[];
  lastViewedAt: string;
  addedAt: string;
  freshness: { asOf: string; isStale: boolean; ageSeconds: number };
}

export function buildDigest(items: WatchlistItemRaw[]) {
  const views: WatchlistItemView[] = items.map(item => {
    const { score, bucket, reason } = computeAttentionScore({
      baselinePrice: item.baselinePrice,
      currentPrice: item.currentPrice,
      currentVolume: item.currentVolume,
      stddevReturn30d: item.stddevReturn30d,
      avgVolume30d: item.avgVolume30d,
      high52w: item.high52w,
      low52w: item.low52w,
    });

    const ageSeconds = Math.max(0, Math.floor((Date.now() - new Date(item.ts).getTime()) / 1000));
    const changeAbs = item.currentPrice - item.baselinePrice;
    const changePct = item.baselinePrice > 0 ? (changeAbs / item.baselinePrice) * 100 : 0;

    return {
      id: item.id,
      symbol: item.symbol,
      name: item.name,
      price: item.currentPrice,
      changePct,
      changeAbs,
      signal: { bucket, score, reason },
      sparkline: item.sparkline,
      lastViewedAt: item.lastViewedAt.toISOString(),
      addedAt: item.addedAt.toISOString(),
      freshness: { asOf: item.ts, isStale: item.isStale || ageSeconds > 120, ageSeconds }
    };
  });

  // Sort items: needs_attention -> notable -> quiet, then alphabetical within
  const bucketOrder = { needs_attention: 0, notable: 1, quiet: 2 };
  views.sort((a, b) => {
    if (bucketOrder[a.signal.bucket] !== bucketOrder[b.signal.bucket]) {
      return bucketOrder[a.signal.bucket] - bucketOrder[b.signal.bucket];
    }
    return a.symbol.localeCompare(b.symbol);
  });

  const digestItems = views
    .filter(v => v.signal.bucket === 'needs_attention' || v.signal.bucket === 'notable')
    .sort((a, b) => b.signal.score - a.signal.score)
    .slice(0, 5);

  return { items: views, digest: { items: digestItems } };
}
