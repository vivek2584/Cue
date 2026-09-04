import type { WatchlistItemView } from '../../types';
import { cn } from '../../lib/utils';

interface DigestStripProps {
  items: WatchlistItemView[];
  onItemClick: (item: WatchlistItemView) => void;
}

export function DigestStrip({ items, onItemClick }: DigestStripProps) {
  if (items.length === 0) {
    return (
      <div className="mb-8">
        <h2 className="font-display text-lg mb-4 text-ink flex items-center">
          Since you last checked
          <span className="ml-4 h-[1px] flex-1 bg-muted/20 block" />
        </h2>
        <div className="text-muted text-sm italic">
          Nothing worth interrupting you for — your picks are steady.
        </div>
      </div>
    );
  }

  return (
    <div className="mb-8">
      <h2 className="font-display text-lg mb-4 text-ink flex items-center">
        Since you last checked
        <span className="ml-4 h-[1px] flex-1 bg-muted/20 block" />
      </h2>
      
      <div className="flex gap-4 overflow-x-auto pb-4 hide-scrollbar">
        {items.map(item => (
          <button
            key={item.id}
            onClick={() => onItemClick(item)}
            className="flex-shrink-0 w-64 p-4 border border-muted/20 rounded-md bg-white text-left hover:border-accent/50 transition-colors shadow-sm"
          >
            <div className="flex items-center gap-2 mb-2">
              <div className={cn(
                "w-2 h-2 rounded-full",
                item.signal.bucket === 'needs_attention' ? "bg-signal animate-pulse" : "bg-muted"
              )} />
              <span className="font-medium text-ink">{item.symbol}</span>
            </div>
            <p className="text-sm text-ink leading-snug">
              {item.signal.reason}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
