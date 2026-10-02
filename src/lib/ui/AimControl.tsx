import { compass, degrees } from "@core/format";
import {
  AimLock,
  aimFor,
  compositionStore,
  useComposition,
} from "@state/composition";
import { settingsStore } from "@state/settings";
import { targetAngleFor, useTerrain } from "@state/terrain";
import { useWorld, worldStore } from "@state/world";
import { useShallow } from "zustand/react/shallow";

const signed = (deg: number) => `${deg >= 0 ? "+" : ""}${degrees(deg)}`;
const LOCKS: [AimLock, string, string][] = [
  [AimLock.Target, "Target", "Keep the frame centred on the target location"],
  [AimLock.Sun, "Sun", "Follow the sun as the time changes"],
  [AimLock.Moon, "Moon", "Follow the moon as the time changes"],
  [AimLock.Gc, "GC", "Follow the Galactic Centre as the time changes"],
  [AimLock.Free, "Free", "Aim by hand"],
];

/** The one aim control, shared by the map's Frame tab and the viewfinder's View tab. */
export function AimControl() {
  const c = useComposition(
    useShallow((s) => ({
      aimLock: s.aimLock,
      azimuthDeg: s.azimuthDeg,
      elevationDeg: s.elevationDeg,
    })),
  );
  const pin = useWorld((s) => s.pin);
  const pin2 = useWorld((s) => s.pin2);
  const profile = useTerrain((s) => s.profile);
  const profileKey = useTerrain((s) => s.profileKey);
  const pinGroundM = useTerrain((s) => s.pinGroundM);
  const pin2GroundM = useTerrain((s) => s.pin2GroundM);
  const targetAngleDeg = targetAngleFor(
    worldStore.getState(),
    settingsStore.getState(),
    { profile, profileKey, pinGroundM, pin2GroundM },
  );
  const aim = aimFor(c, { pin, pin2 }, targetAngleDeg);
  const store = compositionStore.getState();
  // Free starts from wherever the camera points now, not the last hand-set angles.
  const pick = (l: AimLock) =>
    l === AimLock.Free
      ? compositionStore.setState({
          aimLock: l,
          azimuthDeg: aim.azimuthDeg,
          elevationDeg: aim.elevationDeg,
        })
      : store.update({ aimLock: l });
  return (
    <div className="kv aim">
      {/* Full width: five locks overflow the map panel's value column. */}
      <b className="v wide">
        <span className="seg" role="radiogroup" aria-label="Aim">
          {LOCKS.map(([l, label, title]) => {
            const off = l === AimLock.Target && !pin2;
            return (
              <button
                key={l}
                role="radio"
                aria-checked={c.aimLock === l}
                className={c.aimLock === l ? "on" : ""}
                data-aim-lock={l}
                disabled={off}
                title={off ? "Place a target location on the map first" : title}
                onClick={() => pick(l)}
              >
                {label}
              </button>
            );
          })}
        </span>
      </b>
      <span className="k">Azimuth</span>
      <b className="v">
        {aim.locked ? (
          <>
            {degrees(aim.azimuthDeg)} {compass(aim.azimuthDeg)}
          </>
        ) : (
          <>
            <input
              type="number"
              min={0}
              max={360}
              step={0.5}
              value={Number(c.azimuthDeg.toFixed(1))}
              onChange={(e) =>
                store.aim(Number(e.target.value) || 0, c.elevationDeg)
              }
              aria-label="Azimuth, degrees"
            />
            <span className="muted">° {compass(c.azimuthDeg)}</span>
          </>
        )}
      </b>
      <span className="k">Elevation</span>
      <b className="v">
        {aim.locked ? (
          // The bearing needs no terrain, but the angle does: say so rather than show the placeholder 0.
          c.aimLock === AimLock.Target && targetAngleDeg == null ? (
            "…"
          ) : (
            signed(aim.elevationDeg)
          )
        ) : (
          <>
            <input
              type="number"
              min={-89}
              max={89}
              step={0.5}
              value={Number(c.elevationDeg.toFixed(1))}
              onChange={(e) =>
                store.aim(c.azimuthDeg, Number(e.target.value) || 0)
              }
              aria-label="Elevation, degrees"
            />
            <span className="muted">°</span>
          </>
        )}
      </b>
    </div>
  );
}
