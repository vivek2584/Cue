import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, LogOut, Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import type { WatchlistResponse, WatchlistItemView } from '../types';
import { useQuotesSocket } from '../hooks/useQuotesSocket';
import { DigestStrip } from '../components/digest/DigestStrip';
import { LedgerTable } from '../components/ledger/LedgerTable';
import { StockDetailDrawer } from '../components/digest/StockDetailDrawer';
import { AddSymbolModal } from '../components/AddSymbolModal';
import { AIPanel } from '../components/ai/AIPanel';

export function Home() {
  const [selectedItem, setSelectedItem] = useState<WatchlistItemView | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isAIPanelOpen, setIsAIPanelOpen] = useState(false);

  const { data, isLoading } = useQuery<WatchlistResponse>({
    queryKey: ['watchlist'],
    queryFn: () => api.get('/watchlist'),
    staleTime: Infinity, // handled by WS updates
  });

  useQuotesSocket();

  const handleLogout = () => {
    localStorage.removeItem('token');
    window.location.reload();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center text-muted">
        Loading watchlist...
      </div>
    );
  }

  const items = data?.items || [];
  const digestItems = data?.digest?.items || [];
  
  // Staleness banners
  const anyStale = items.some(i => i.freshness?.isStale);
  const anySeverelyStale = items.some(i => (i.freshness?.ageSeconds || 0) > 900);

  return (
    <div className="min-h-screen bg-surface font-sans">
      <div className="max-w-[880px] mx-auto px-4 py-8 pb-32">
        {/* Header */}
        <header className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <h1 className="font-display text-2xl text-ink">Smart Watchlist</h1>
            {(anyStale || anySeverelyStale) && (
              <span className="text-xs bg-fall/10 text-fall px-2 py-1 rounded">
                Prices delayed
              </span>
            )}
          </div>
          <div className="flex gap-4">
            <button 
              onClick={() => setIsAddModalOpen(true)}
              className="flex items-center gap-1 text-sm font-medium text-accent hover:text-accent/80 transition-default"
            >
              <Plus size={16} /> Add
            </button>
            <button 
              onClick={handleLogout}
              className="flex items-center gap-1 text-sm font-medium text-muted hover:text-ink transition-default"
            >
              <LogOut size={16} /> Logout
            </button>
          </div>
        </header>

        {/* Digest */}
        <DigestStrip 
          items={digestItems} 
          onItemClick={setSelectedItem} 
        />

        {/* Ledger */}
        <LedgerTable 
          items={items} 
          onRowClick={setSelectedItem} 
        />
      </div>

      {/* Floating AI Button */}
      <button
        onClick={() => setIsAIPanelOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-[var(--signal)] text-white rounded-full shadow-lg hover:shadow-xl flex items-center justify-center transition-all hover:scale-105 z-40"
        aria-label="Open AI Assistant"
      >
        <Sparkles size={24} />
      </button>

      {/* Modals/Drawers */}
      <StockDetailDrawer 
        item={selectedItem} 
        onClose={() => setSelectedItem(null)} 
      />
      
      {isAddModalOpen && (
        <AddSymbolModal 
          onClose={() => setIsAddModalOpen(false)} 
        />
      )}

      {isAIPanelOpen && (
        <AIPanel onClose={() => setIsAIPanelOpen(false)} />
      )}
    </div>
  );
}
