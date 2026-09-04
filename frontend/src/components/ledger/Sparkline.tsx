import { LineChart, Line, YAxis } from 'recharts';

interface SparklineProps {
  data: number[];
  color: string;
}

export function Sparkline({ data, color }: SparklineProps) {
  if (!data || data.length === 0) return null;
  
  // If only 1 data point, duplicate it to draw a flat horizontal line
  const safeData = data.length === 1 ? [data[0], data[0]] : data;
  
  const chartData = safeData.map((value, i) => ({ i, value }));
  const min = Math.min(...safeData);
  const max = Math.max(...safeData);
  
  // Prevent Recharts domain crash if the line is completely flat
  const spread = max - min;
  const padding = spread === 0 ? max * 0.001 : spread * 0.1;
  const domain = [min - padding, max + padding];

  return (
    <div className="h-8 w-24">
      <LineChart width={96} height={32} data={chartData}>
        <YAxis domain={domain} hide />
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </div>
  );
}
