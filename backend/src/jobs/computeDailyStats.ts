import { prisma } from '../db/prisma';

export async function computeDailyStats() {
  console.log('Running nightly stats computation...');
  const instruments = await prisma.instrument.findMany({ where: { isActive: true } });

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  for (const instrument of instruments) {
    const symbol = instrument.symbol;
    
    // Get last 30 days
    const last30 = await prisma.priceSnapshot.findMany({
      where: { symbol, ts: { gte: thirtyDaysAgo } },
      orderBy: { ts: 'asc' }
    });

    if (last30.length < 2) continue; // Need at least 2 for stddev

    // Get 52w high/low
    const last52w = await prisma.priceSnapshot.aggregate({
      where: { symbol, ts: { gte: oneYearAgo } },
      _max: { price: true },
      _min: { price: true }
    });

    const high52w = last52w._max.price ? Number(last52w._max.price) : 0;
    const low52w = last52w._min.price ? Number(last52w._min.price) : 0;

    // Calc avg volume 30d
    const avgVolume30d = Math.floor(
      last30.reduce((sum, s) => sum + Number(s.volume), 0) / last30.length
    );

    // Calc stddev of daily returns
    const returns: number[] = [];
    for (let i = 1; i < last30.length; i++) {
      const prev = Number(last30[i - 1].price);
      const curr = Number(last30[i].price);
      if (prev > 0) {
        returns.push((curr - prev) / prev);
      }
    }

    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
    const stddevReturn30d = Math.sqrt(variance);

    await prisma.symbolStatsDaily.upsert({
      where: { symbol_date: { symbol, date: new Date() } },
      update: {
        stddevReturn30d,
        avgVolume30d: BigInt(avgVolume30d),
        high52w,
        low52w
      },
      create: {
        symbol,
        date: new Date(),
        stddevReturn30d,
        avgVolume30d: BigInt(avgVolume30d),
        high52w,
        low52w
      }
    });
  }
  console.log('Finished nightly stats computation.');
}
