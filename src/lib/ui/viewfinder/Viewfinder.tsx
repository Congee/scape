import { useEffect, useRef } from 'react';
import { viewfinderStore } from '@state/viewfinder';
import { parkScene, takeScene } from './parkedScene';
import { ViewfinderController } from './ViewfinderController';

export function Viewfinder() {
  const ref = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scene = takeScene();
    glRef.current!.append(scene.canvas);
    const controller = new ViewfinderController(ref.current!, scene.gl, scene.error);
    return () => {
      controller.dispose();
      parkScene(scene);
      viewfinderStore.getState().setWindow(null);
      viewfinderStore.getState().setMeshWindow(null);
    };
  }, []);
  return (
    <>
      {/* The picture, reference photo and sky marks; the canvas above it keeps labels and the frame. The GL canvas outlives this view. */}
      <div ref={glRef} className="vf-gl-host" />
      <canvas
        ref={ref}
        className="vf"
        tabIndex={0}
        aria-label="Viewfinder. Drag to aim, scroll to zoom, double-click to aim at a point; arrow keys turn by a degree, Shift by ten; + and − change the focal length."
      />
    </>
  );
}
