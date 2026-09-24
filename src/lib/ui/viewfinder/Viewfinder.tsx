import { useEffect, useRef } from 'react';
import { viewfinderStore } from '@state/viewfinder';
import { ViewfinderController } from './ViewfinderController';

export function Viewfinder() {
  const ref = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const photoRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new ViewfinderController(ref.current!, glRef.current!, photoRef.current);
    return () => {
      controller.dispose();
      viewfinderStore.getState().setWindow(null);
      viewfinderStore.getState().setMeshWindow(null);
    };
  }, []);
  return (
    <>
      {/* The picture; the canvas above it keeps the sky objects, labels and the frame. */}
      <canvas ref={glRef} className="vf-gl" aria-hidden="true" />
      {/* Reference photo between the picture and the overlay, so labels and drags stay on top. */}
      <div ref={photoRef} className="vf-photo" hidden>
        <img alt="Reference photo" />
      </div>
      <canvas
        ref={ref}
        className="vf"
        tabIndex={0}
        aria-label="Viewfinder. Drag to aim, scroll to zoom, double-click to aim at a point; arrow keys turn by a degree, Shift by ten; + and − change the focal length."
      />
    </>
  );
}
