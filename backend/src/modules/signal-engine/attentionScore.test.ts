import { computeAttentionScore } from './attentionScore';

describe('attentionScore', () => {
  it('identifies quiet stocks (no unusual movement)', () => {
    const result = computeAttentionScore({
      baselinePrice: 100,
      currentPrice: 100, // No price change
      currentVolume: 1000,
      stddevReturn30d: 0.01,
      avgVolume30d: 1000,
      high52w: 150,
      low52w: 80,
    });
    
    expect(result.bucket).toBe('quiet');
    expect(result.score).toBe(0);
    expect(result.reason).toBe('No unusual movement since you last checked');
  });

  it('identifies needs_attention from high z-score (small move but very low stddev)', () => {
    const result = computeAttentionScore({
      baselinePrice: 100,
      currentPrice: 105, // +5% move
      currentVolume: 1000,
      stddevReturn30d: 0.005, // Historical volatility is only 0.5% (very stable)
      avgVolume30d: 1000,
      high52w: 150,
      low52w: 80,
    });
    
    expect(result.bucket).toBe('needs_attention');
    expect(result.score).toBeGreaterThan(2.0);
    expect(result.reason).toContain('Up 5.0%');
  });

  it('keeps volatile stocks quiet on large but normal moves', () => {
    const result = computeAttentionScore({
      baselinePrice: 100,
      currentPrice: 105, // +5% move
      currentVolume: 1000,
      stddevReturn30d: 0.08, // Historical volatility is 8% (highly volatile)
      avgVolume30d: 1000,
      high52w: 150,
      low52w: 80,
    });
    
    expect(result.bucket).toBe('quiet');
    expect(result.score).toBeLessThan(0.8);
  });

  it('identifies notable from volume spike alone', () => {
    const result = computeAttentionScore({
      baselinePrice: 100,
      currentPrice: 100, // No price change
      currentVolume: 3000, // 3x volume spike => volSignal = 2 => score = 1.0
      stddevReturn30d: 0.02,
      avgVolume30d: 1000,
      high52w: 150,
      low52w: 80,
    });
    
    expect(result.bucket).toBe('notable');
    expect(result.score).toBe(1.0);
    expect(result.reason).toContain('Trading at 3.0× normal volume');
  });

  it('caps volume signal at 3x max', () => {
    const result = computeAttentionScore({
      baselinePrice: 100,
      currentPrice: 100,
      currentVolume: 10000, // 10x volume spike
      stddevReturn30d: 0.02,
      avgVolume30d: 1000,
      high52w: 150,
      low52w: 80,
    });
    
    // Volume max contribution is 0.5 * 3 = 1.5
    expect(result.bucket).toBe('notable');
    expect(result.score).toBe(1.5);
    expect(result.reason).toContain('Trading at 10.0× normal volume');
  });

  it('flags 52-week high hits', () => {
    const result = computeAttentionScore({
      baselinePrice: 145,
      currentPrice: 151, // Above high52w of 150
      currentVolume: 1000,
      stddevReturn30d: 0.02,
      avgVolume30d: 1000,
      high52w: 150,
      low52w: 80,
    });
    
    expect(result.bucket).toBe('needs_attention');
    expect(result.score).toBeGreaterThan(1.5); // Gets +1.5 boost for extreme hit
    expect(result.reason).toContain('Hit a new 52-week high');
  });

  it('flags 52-week low hits', () => {
    const result = computeAttentionScore({
      baselinePrice: 85,
      currentPrice: 79, // Below low52w of 80
      currentVolume: 1000,
      stddevReturn30d: 0.02,
      avgVolume30d: 1000,
      high52w: 150,
      low52w: 80,
    });
    
    expect(result.bucket).toBe('needs_attention');
    expect(result.reason).toContain('Hit a new 52-week low');
    expect(result.reason).toContain('Down');
  });

  it('combines multiple reasons with separator, max 2', () => {
    const result = computeAttentionScore({
      baselinePrice: 145,
      currentPrice: 151, // Up (z-score high) AND hit 52w high
      currentVolume: 3000, // AND 3x volume
      stddevReturn30d: 0.01,
      avgVolume30d: 1000,
      high52w: 150,
      low52w: 80,
    });
    
    expect(result.bucket).toBe('needs_attention');
    expect(result.reason).toContain('Up');
    expect(result.reason).toContain('Hit a new 52-week high');
    expect(result.reason).toContain(' · ');
    expect(result.reason).not.toContain('volume'); // Capped at 2
  });

  it('guards against division by zero for baselinePrice', () => {
    const result = computeAttentionScore({
      baselinePrice: 0,
      currentPrice: 100,
      currentVolume: 1000,
      stddevReturn30d: 0.01,
      avgVolume30d: 1000,
      high52w: 150,
      low52w: 80,
    });
    
    expect(result.score).toBe(0);
    expect(result.bucket).toBe('quiet');
    expect(result.reason).toBe('Waiting for initial price');
  });

  it('floors stddev at 0.001 to prevent infinity z-scores', () => {
    const result = computeAttentionScore({
      baselinePrice: 100,
      currentPrice: 101, // +1%
      currentVolume: 1000,
      stddevReturn30d: 0, // Zero stddev
      avgVolume30d: 1000,
      high52w: 150,
      low52w: 80,
    });
    
    // (101-100)/100 = 0.01. z = 0.01 / 0.001 = 10
    expect(result.score).toBeCloseTo(10.0, 1);
  });
});
