import { useEffect, useRef } from 'react';
import { ProfileController } from './ProfileController';

export function ProfileChart() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = new ProfileController(ref.current!);
    return () => c.dispose();
  }, []);
  return <canvas ref={ref} className="profile" aria-label="Elevation profile between the pins with the sight line" />;
}
