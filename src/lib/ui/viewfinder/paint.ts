import type { Observer } from 'astronomy-engine';
import type { SkyBody } from '@core/astro/bodies';
import type { Light } from '@core/astro/lightSource';
import type { Occluder } from '@core/geo/meshOcclude';
import type { OverlayBatch } from '@core/viewfinder/gl/overlayGl';
import type { FitViewports, Rect } from '@core/viewfinder/frameFit';
import type { PlaceView } from '@core/viewfinder/place';
import type { ViewProfile } from '@core/terrain/view';
import type { Aim } from '@state/composition';

export interface Scene extends PlaceView {
  aim: Aim;
  /** False while a locked aim has no target elevation yet, so its 0 is a placeholder. */
  aimKnown: boolean;
  vp: FitViewports;
  hfov: number;
  vfov: number;
  /** Field of view across the whole area. */
  viewHfov: number;
  viewVfov: number;
  view: ViewProfile | null;
  eyeM: number;
  sunAlt: number;
  sunAz: number;
  /** The body casting shadows, from the light-source setting. */
  light: Light | null;
  time: Date;
  obs: Observer;
  /** How dark the sky is for stars, 0 by day to 1 in astronomical night. */
  night: number;
  /** Moonlight washing out faint stars and the Milky Way, 0..1. */
  moonFactor: number;
  /** Moon's lit fraction times what a lunar eclipse leaves of its light. */
  moonLight: number;
}

/** What the overlay hid this frame, for `__scape.overlay`. */
export interface Seen {
  bodies: Record<string, { az: number; alt: number; x: number; y: number; r: number; hidden: boolean }>;
  markers: Record<string, boolean>;
  pathLabels: { body: SkyBody; text: string; x: number; y: number; w: number; h: number; skipped: boolean }[];
}

/** One frame's canvas, mark batch for the picture pass and building occlusion, shared by the painters. */
export interface Paint {
  ctx: CanvasRenderingContext2D;
  marks: OverlayBatch;
  /** Dev: marks with the exact CPU answer, 6 numbers each, while `__scape.markProbe` is set. */
  probe: number[] | null;
  occ: Occluder | null;
  seen: Seen;
}

/** Text inside the picture: a dark outline keeps it readable over sun-lit white towers. */
export const haloText = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number) => {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.strokeText(text, x, y);
  ctx.restore();
  ctx.fillText(text, x, y);
};

/** Saves the context and clips it to the picture area; the caller restores. */
export const clipToArea = (ctx: CanvasRenderingContext2D, a: Rect) => {
  ctx.save();
  ctx.beginPath();
  ctx.rect(a.x, a.y, a.w, a.h);
  ctx.clip();
};
