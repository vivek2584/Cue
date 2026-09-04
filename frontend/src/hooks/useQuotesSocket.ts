import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { WatchlistResponse } from '../types';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:4000/ws';

export function useQuotesSocket() {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let isUnmounted = false;
    const token = localStorage.getItem('token');
    if (!token) return;

    const connect = () => {
      const ws = new WebSocket(`${WS_URL}?token=${token}`);
      
      ws.onopen = () => {
        if (isUnmounted) return;
        console.log('WS connected');
        setRetryCount(0); // Reset backoff on successful connection

        // Subscribe to currently visible symbols from the TanStack query cache
        const data = queryClient.getQueryData<WatchlistResponse>(['watchlist']);
        if (data?.items) {
          const symbols = data.items.map(i => i.symbol);
          if (symbols.length > 0) {
            ws.send(JSON.stringify({ type: 'subscribe', symbols }));
          }
        }
      };

      ws.onmessage = (event) => {
        if (isUnmounted) return;
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'quote') {
            queryClient.setQueryData(['watchlist'], (old: WatchlistResponse | undefined) => {
              if (!old) return old;

              const updateItem = (item: any) => {
                if (item.symbol === data.symbol) {
                  const baseline = Number(item.baselinePrice);
                  const changeAbs = data.price - baseline;
                  const changePct = baseline > 0 ? (changeAbs / baseline) * 100 : 0;
                  
                  return {
                    ...item,
                    price: data.price,
                    changeAbs,
                    changePct,
                    freshness: {
                      ...item.freshness,
                      asOf: data.ts,
                      isStale: data.isStale
                    }
                  };
                }
                return item;
              };

              return {
                items: old.items.map(updateItem),
                digest: {
                  items: old.digest.items.map(updateItem)
                }
              };
            });
          } else if (data.type === 'digest_update') {
            // Re-fetch everything if we get a digest update (e.g. from tick worker resolving new signals)
            queryClient.invalidateQueries({ queryKey: ['watchlist'] });
          }
        } catch (err) {
          console.error('WS message error', err);
        }
      };

      ws.onclose = (event) => {
        if (isUnmounted) return;
        if (event.code === 1008) {
          console.error('WS auth failed, not reconnecting.');
          localStorage.removeItem('token');
          window.dispatchEvent(new Event('auth-error'));
          return;
        }
        
        // Exponential backoff: 2s, 4s, 8s, 16s... up to 30s max
        const backoffMs = Math.min(30000, 2000 * Math.pow(2, retryCount));
        console.log(`WS disconnected, reconnecting in ${backoffMs / 1000}s`);
        
        reconnectTimeoutRef.current = setTimeout(() => {
          setRetryCount(c => c + 1);
          connect();
        }, backoffMs);
      };

      wsRef.current = ws;
    };

    connect();

    return () => {
      isUnmounted = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [queryClient, retryCount]);
}
