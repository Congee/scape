import { useEffect, useRef } from 'react';
import { viewfinderStore } from '@state/viewfinder';
import { ViewfinderController } from './ViewfinderController';

export function Viewfinder() {
  const ref = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const controller = new ViewfinderController(ref.current!, glRef.current!);
    return () => {
      controller.dispose();
      viewfinderStore.getState().setWindow(null);
      viewfinderStore.getState().setMeshWindow(null);
    };
  }, []);
  return (
    <>
      {/* The picture, reference photo and sky marks; the canvas above it keeps labels and the frame. */}
      <canvas ref={glRef} className="vf-gl" aria-hidden="true" />
      <canvas
        ref={ref}
        className="vf"
        tabIndex={0}
        aria-label="Viewfinder. Drag to aim, scroll to zoom, double-click to aim at a point; arrow keys turn by a degree, Shift by ten; + and − change the focal length."
      />
    </>
  );
}
