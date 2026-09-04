import { useState, useEffect } from 'react';
import { X, Search } from 'lucide-react';
import { api } from '../lib/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';

interface AddSymbolModalProps {
  onClose: () => void;
}

export function AddSymbolModal({ onClose }: AddSymbolModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ symbol: string; name: string }[]>([]);
  const queryClient = useQueryClient();

  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.trim()) {
        api.get(`/instruments/search?q=${encodeURIComponent(query)}`)
          .then(setResults)
          .catch(console.error);
      } else {
        setResults([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const addMutation = useMutation({
    mutationFn: ({ symbol, name }: { symbol: string; name: string }) => api.post('/watchlist/items', { symbol, name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['watchlist'] });
      onClose();
    }
  });

  return (
    <>
      <div className="fixed inset-0 bg-ink/20 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-surface shadow-2xl z-50 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-muted/20 flex items-center">
          <Search size={20} className="text-muted mr-3" />
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search symbols or company name..."
            className="flex-1 bg-transparent outline-none text-ink placeholder:text-muted/60"
          />
          <button onClick={onClose} className="p-1 hover:bg-muted/10 rounded">
            <X size={20} className="text-muted" />
          </button>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {results.length === 0 && query.trim() ? (
            <div className="p-4 text-center text-muted">No results found</div>
          ) : (
            results.map(r => (
              <div key={r.symbol} className="p-4 flex items-center justify-between border-b border-muted/10 hover:bg-muted/5 transition-colors">
                <div>
                  <div className="font-medium text-ink">{r.symbol}</div>
                  <div className="text-sm text-muted">{r.name}</div>
                </div>
                <button
                  onClick={() => addMutation.mutate({ symbol: r.symbol, name: r.name })}
                  disabled={addMutation.isPending}
                  className="px-3 py-1 bg-accent/10 text-accent hover:bg-accent hover:text-white rounded text-sm transition-colors"
                >
                  Add
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
