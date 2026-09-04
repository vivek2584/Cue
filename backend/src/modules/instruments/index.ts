import { Router, Request, Response } from 'express';
import { MarketDataService } from '../market-data/MarketDataService';

const router = Router();
const marketData = MarketDataService.getInstance();

router.get('/search', async (req: Request, res: Response) => {
  const query = req.query.q as string;
  if (!query || !query.trim()) {
    return res.json([]);
  }

  try {
    const results = await marketData.search(query.trim());
    res.json(results);
  } catch (error) {
    console.error('[Instruments] Search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as instrumentsRouter };
