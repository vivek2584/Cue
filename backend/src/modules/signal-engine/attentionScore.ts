export type Bucket = 'needs_attention' | 'notable' | 'quiet';

export interface ScoreResult {
  score: number;
  bucket: Bucket;
  reason: string;
}

export function computeAttentionScore(inputs: {
  baselinePrice: number;
  currentPrice: number;
  currentVolume: number;
  stddevReturn30d: number;
  avgVolume30d: number;
  high52w: number;
  low52w: number;
}): ScoreResult {
  const {
    baselinePrice,
    currentPrice,
    currentVolume,
    stddevReturn30d,
    avgVolume30d,
    high52w,
    low52w,
  } = inputs;

  if (baselinePrice === 0 || isNaN(baselinePrice)) {
    return { score: 0, bucket: 'quiet', reason: 'Waiting for initial price' };
  }

  const pctChange = (currentPrice - baselinePrice) / baselinePrice;
  const safeStddev = Math.max(stddevReturn30d, 0.001);
  const zScore = pctChange / safeStddev;
  
  const volRatio = currentVolume / Math.max(avgVolume30d, 1);
  const volSignal = Math.max(0, volRatio - 1);
  
  const extremeHit = (currentPrice >= high52w || currentPrice <= low52w) ? 1 : 0;

  const score = (1.0 * Math.abs(zScore)) + (0.5 * Math.min(volSignal, 3)) + (1.5 * extremeHit);

  let bucket: Bucket = 'quiet';
  if (score >= 2.0) bucket = 'needs_attention';
  else if (score >= 0.8) bucket = 'notable';

  // Construct reasons
  const reasons: string[] = [];
  if (extremeHit) {
    reasons.push(`Hit a new 52-week ${currentPrice >= high52w ? 'high' : 'low'}`);
  }
  if (Math.abs(zScore) >= 2) {
    const dir = pctChange >= 0 ? 'Up' : 'Down';
    reasons.push(`${dir} ${(Math.abs(pctChange) * 100).toFixed(1)}% — about ${Math.abs(zScore).toFixed(1)}× its usual daily move`);
  }
  if (volRatio >= 2) {
    reasons.push(`Trading at ${volRatio.toFixed(1)}× normal volume`);
  }

  let reason = '';
  if (reasons.length > 0) {
    reason = reasons.slice(0, 2).join(' · ');
  } else if (bucket === 'quiet') {
    reason = 'No unusual movement since you last checked';
  } else {
    // If it scored >= 0.8 but didn't hit the explicit thresholds for reasons
    reason = 'Slightly elevated activity';
  }

  return { score, bucket, reason };
}
