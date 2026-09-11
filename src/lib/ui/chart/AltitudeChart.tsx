import { useEffect, useRef } from 'react';
import { ChartController } from './ChartController';

export function AltitudeChart() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const chart = new ChartController(ref.current!);
    return () => chart.dispose();
  }, []);
  return (
    <canvas
      ref={ref}
      className="chart"
      tabIndex={0}
      aria-label="Altitude chart. Drag to set the time; arrow keys nudge by a minute, Shift ten minutes, Alt an hour; Page Up/Down change the day."
    />
  );
}
