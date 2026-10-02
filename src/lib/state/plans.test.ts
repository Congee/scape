import { describe, expect, it } from "vitest";
import { Orientation } from "@core/optics/fov";
import type { PlanComposition } from "@core/plan";
import { planAimLock } from "./plans";

const base: PlanComposition = {
  sensorId: "ff",
  focalMm: 600,
  fNumber: 4,
  orientation: Orientation.Landscape,
  azimuthDeg: 0,
  elevationDeg: 0,
};

describe("planAimLock", () => {
  it("reads the old flag of plans saved before the lock", () => {
    expect(planAimLock({ ...base, aimAtTarget: true })).toBe("Target");
    expect(planAimLock({ ...base, aimAtTarget: false })).toBe("Free");
    expect(planAimLock(base)).toBe("Free");
  });

  it("prefers the lock and frees an unknown one", () => {
    expect(planAimLock({ ...base, aimLock: "Gc", aimAtTarget: true })).toBe(
      "Gc",
    );
    expect(planAimLock({ ...base, aimLock: "Venus" })).toBe("Free");
  });
});
