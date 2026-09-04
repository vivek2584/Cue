import type { WatchlistItemView } from '../../types';
import { formatCurrency, formatPercent, cn } from '../../lib/utils';
import { Sparkline } from './Sparkline';

interface LedgerRowProps {
  item: WatchlistItemView;
  onClick: () => void;
}

export function LedgerRow({ item, onClick }: LedgerRowProps) {
  const isPositive = item.changePct >= 0;
  const isNotable = item.signal.bucket !== 'quiet';
  const isAttention = item.signal.bucket === 'needs_attention';

  return (
    <tr 
      onClick={onClick}
      className="border-b border-muted/10 hover:bg-muted/5 cursor-pointer transition-colors"
    >
      <td className="py-3 px-4">
        <div className="font-medium text-ink">{item.symbol}</div>
        <div className="text-xs text-muted truncate max-w-[120px]">{item.name}</div>
      </td>
      <td className="py-3 px-4 text-right font-mono text-ink">
        {formatCurrency(item.price)}
      </td>
      <td className="py-3 px-4 text-right font-mono">
        <span className={cn(isPositive ? 'text-rise' : 'text-fall')}>
          {formatPercent(item.changePct)}
        </span>
      </td>
      <td className="py-3 px-4 text-center">
        {isNotable ? (
          <div className="flex justify-center">
            <div className={cn(
              "w-2.5 h-2.5 rounded-full",
              isAttention ? "bg-signal animate-pulse" : "bg-muted"
            )} />
          </div>
        ) : (
          <div className="flex justify-center">
             <div className="w-2.5 h-2.5 rounded-full bg-muted/30" />
          </div>
        )}
      </td>
      <td className="py-3 px-4">
        <div className="flex justify-center">
          <Sparkline 
            data={item.sparkline.length > 0 ? item.sparkline : [item.price]} 
            color={isPositive ? 'var(--rise)' : 'var(--fall)'} 
          />
        </div>
      </td>
    </tr>
  );
}
