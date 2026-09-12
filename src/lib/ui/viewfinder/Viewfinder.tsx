import { useEffect, useRef } from 'react';
import { viewfinderStore } from '@state/viewfinder';
import { ViewfinderController } from './ViewfinderController';

export function Viewfinder() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const controller = new ViewfinderController(ref.current!);
    return () => {
      controller.dispose();
      viewfinderStore.getState().setWindow(null);
    };
  }, []);
  return (
    <canvas
      ref={ref}
      className="vf"
      tabIndex={0}
      aria-label="Viewfinder. Drag to aim, scroll to zoom, double-click to aim at a point; arrow keys turn by a degree, Shift by ten; + and − change the focal length."
    />
  );
}
