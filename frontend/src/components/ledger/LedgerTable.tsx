import type { WatchlistItemView } from '../../types';
import { LedgerRow } from './LedgerRow';

interface LedgerTableProps {
  items: WatchlistItemView[];
  onRowClick: (item: WatchlistItemView) => void;
}

export function LedgerTable({ items, onRowClick }: LedgerTableProps) {
  if (items.length === 0) {
    return (
      <div className="text-center py-12 px-4 border border-muted/20 rounded-md bg-white">
        <h3 className="text-ink font-medium mb-2">Nothing here yet</h3>
        <p className="text-muted text-sm">Add a stock to start tracking what matters.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-md border border-muted/20 overflow-hidden">
      <table className="w-full text-sm text-left table-fixed">
        <thead className="text-xs text-muted bg-surface/50 uppercase">
          <tr>
            <th className="py-3 px-4 font-medium w-1/3">Symbol</th>
            <th className="py-3 px-4 font-medium text-right w-1/6">Price</th>
            <th className="py-3 px-4 font-medium text-right w-1/6">Change</th>
            <th className="py-3 px-4 font-medium text-center w-1/6">Signal</th>
            <th className="py-3 px-4 font-medium text-center w-1/6">7d</th>
          </tr>
        </thead>
        <tbody>
          {items.map(item => (
            <LedgerRow 
              key={item.id} 
              item={item} 
              onClick={() => onRowClick(item)} 
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
