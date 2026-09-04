import { buildDigest, WatchlistItemRaw } from './digest';

describe('buildDigest', () => {
  const baseItem: WatchlistItemRaw = {
    id: '1',
    symbol: 'TEST',
    name: 'Test Corp',
    baselinePrice: 100,
    addedAt: new Date(),
    lastViewedAt: new Date(),
    currentPrice: 100,
    currentVolume: 1000,
    ts: new Date().toISOString(),
    isStale: false,
    stddevReturn30d: 0.01,
    avgVolume30d: 1000,
    high52w: 150,
    low52w: 50,
    sparkline: [],
  };

  it('handles empty input', () => {
    const result = buildDigest([]);
    expect(result.items).toEqual([]);
    expect(result.digest.items).toEqual([]);
  });

  it('filters out quiet items from the digest', () => {
    // 0% move = quiet
    const items = [{ ...baseItem, id: '1', symbol: 'QUIET', currentPrice: 100 }];
    const result = buildDigest(items);
    
    expect(result.items).toHaveLength(1); // Still in full list
    expect(result.digest.items).toHaveLength(0); // But not in digest
  });

  it('includes needs_attention and notable items', () => {
    const items = [
      { ...baseItem, id: '1', symbol: 'ATTENTION', currentPrice: 110, stddevReturn30d: 0.01 }, // Massive +10% move on 1% stddev
      { ...baseItem, id: '2', symbol: 'NOTABLE', currentPrice: 101, stddevReturn30d: 0.01 }, // Modest +1% move
    ];
    
    const result = buildDigest(items);
    expect(result.digest.items).toHaveLength(2);
    expect(result.digest.items[0].symbol).toBe('ATTENTION'); // Highest score first
    expect(result.digest.items[1].symbol).toBe('NOTABLE');
  });

  it('sorts full items list by bucket then alphabetical', () => {
    const items = [
      { ...baseItem, id: '1', symbol: 'Z_QUIET', currentPrice: 100 },
      { ...baseItem, id: '2', symbol: 'A_QUIET', currentPrice: 100 },
      { ...baseItem, id: '3', symbol: 'B_ATTENTION', currentPrice: 110, stddevReturn30d: 0.01 },
      { ...baseItem, id: '4', symbol: 'A_ATTENTION', currentPrice: 110, stddevReturn30d: 0.01 },
    ];
    
    const result = buildDigest(items);
    expect(result.items.map(i => i.symbol)).toEqual([
      'A_ATTENTION', 'B_ATTENTION', 'A_QUIET', 'Z_QUIET'
    ]);
  });

  it('caps digest at 5 items', () => {
    const items = Array.from({ length: 10 }).map((_, i) => ({
      ...baseItem,
      id: String(i),
      symbol: 'SYM' + i,
      currentPrice: 105, // All are needs_attention
    }));
    
    const result = buildDigest(items);
    expect(result.items).toHaveLength(10); // Full list unchanged
    expect(result.digest.items).toHaveLength(5); // Digest capped
  });

  it('calculates freshness correctly', () => {
    const now = Date.now();
    const tenMinutesAgo = new Date(now - 10 * 60 * 1000).toISOString();
    
    const items = [{ ...baseItem, currentPrice: 105, ts: tenMinutesAgo, isStale: true }];
    const result = buildDigest(items);
    
    const item = result.items[0];
    expect(item.freshness.isStale).toBe(true);
    expect(item.freshness.ageSeconds).toBeGreaterThanOrEqual(599); // allow 1s variance
    expect(item.freshness.ageSeconds).toBeLessThanOrEqual(601);
  });

  it('calculates changePct correctly', () => {
    const items = [{ ...baseItem, baselinePrice: 100, currentPrice: 125, stddevReturn30d: 0.001 }]; // +25%
    const result = buildDigest(items);
    
    expect(result.items[0].changeAbs).toBe(25);
    expect(result.items[0].changePct).toBe(25);
  });
});
