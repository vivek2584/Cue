import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { X } from 'lucide-react';
import type { WatchlistItemView } from '../../types';
import { api } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { useMutation, useQueryClient } from '@tanstack/react-query';

interface StockDetailDrawerProps {
  item: WatchlistItemView | null;
  onClose: () => void;
}

interface DetailData {
  history: { date: string; close: number; volume: number }[];
  reasons: string[];
  stats: { stddev30d: number; avgVolume30d: number; high52w: number; low52w: number } | null;
}

export function StockDetailDrawer({ item, onClose }: StockDetailDrawerProps) {
  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (item) {
      setLoading(true);
      api.get(`/watchlist/items/${item.id}/detail`)
        .then(res => setData(res))
        .catch(console.error)
        .finally(() => setLoading(false));
    } else {
      setData(null);
    }
  }, [item]);

  const ackMutation = useMutation({
    mutationFn: () => api.post(`/watchlist/items/${item?.id}/ack`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['watchlist'] });
      onClose();
    }
  });

  if (!item) return null;

  return (
    <>
      <div 
        className="fixed inset-0 bg-ink/20 backdrop-blur-sm z-40 transition-opacity"
        onClick={onClose}
      />
      
      <div className="fixed top-0 right-0 h-full w-full max-w-md bg-surface shadow-2xl z-50 transform transition-transform overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-2xl font-display text-ink">{item.symbol}</h2>
              <p className="text-muted">{item.name}</p>
            </div>
            <button 
              onClick={onClose}
              className="p-2 hover:bg-muted/10 rounded-full transition-colors text-muted"
            >
              <X size={24} />
            </button>
          </div>

          <div className="mb-8">
            <div className="text-3xl font-mono text-ink mb-1">
              {formatCurrency(item.price)}
            </div>
            <p className="text-muted">
              Latest quote as of {new Date(item.freshness.asOf).toLocaleTimeString()}
            </p>
          </div>

          {loading ? (
            <div className="h-48 flex items-center justify-center text-muted">Loading chart...</div>
          ) : data?.history ? (
            <div className="h-48 mb-8 -ml-4">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.history}>
                  <XAxis 
                    dataKey="date" 
                    hide 
                  />
                  <YAxis 
                    domain={['auto', 'auto']} 
                    hide 
                  />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'var(--surface)', borderColor: 'var(--muted)', borderRadius: '6px' }}
                    labelFormatter={() => ''}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="close" 
                    stroke="var(--ink)" 
                    strokeWidth={2} 
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : null}

          {item.signal.bucket !== 'quiet' && (
            <div className="mb-8 bg-white p-4 rounded-md border border-signal/30 shadow-sm">
              <h3 className="font-medium text-ink mb-2 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-signal" />
                Why it's flagged
              </h3>
              <p className="text-sm text-ink leading-relaxed">
                {item.signal.reason}
              </p>
            </div>
          )}

          {data?.stats && (
            <div className="mb-8">
              <h3 className="font-medium text-ink mb-4">Key Stats</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white p-3 rounded border border-muted/20">
                  <div className="text-xs text-muted mb-1">30d Volatility (σ)</div>
                  <div className="font-mono text-ink">{(data.stats.stddev30d * 100).toFixed(2)}%</div>
                </div>
                <div className="bg-white p-3 rounded border border-muted/20">
                  <div className="text-xs text-muted mb-1">30d Avg Volume</div>
                  <div className="font-mono text-ink">{(data.stats.avgVolume30d / 1000000).toFixed(1)}M</div>
                </div>
                <div className="bg-white p-3 rounded border border-muted/20">
                  <div className="text-xs text-muted mb-1">52W High</div>
                  <div className="font-mono text-ink">{formatCurrency(data.stats.high52w)}</div>
                </div>
                <div className="bg-white p-3 rounded border border-muted/20">
                  <div className="text-xs text-muted mb-1">52W Low</div>
                  <div className="font-mono text-ink">{formatCurrency(data.stats.low52w)}</div>
                </div>
              </div>
            </div>
          )}

          <div className="pt-4 border-t border-muted/20">
            <button
              onClick={() => ackMutation.mutate()}
              disabled={ackMutation.isPending}
              className="w-full bg-ink text-white py-3 rounded-md font-medium hover:bg-ink/90 transition-colors disabled:opacity-50"
            >
              {ackMutation.isPending ? 'Marking...' : 'Mark as reviewed'}
            </button>
            <p className="text-xs text-center text-muted mt-3">
              This resets its baseline so it only flags again on new activity.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
