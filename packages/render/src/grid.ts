/** Pure grid maths (SPEC §7): adaptive step, major-line period. */

export const GRID_STEPS = [100, 500, 1000, 2000, 5000] as const;

/** Smallest step (mm) that is at least 9 px on screen. */
export function gridStep(s: number): number {
  let step = GRID_STEPS[GRID_STEPS.length - 1] as number;
  for (const m of GRID_STEPS) {
    step = m;
    if (m * s >= 9) break;
  }
  return step;
}

/** Major lines every 1000 mm, or 5× the step once the step itself is ≥ 1000. */
export function gridMajor(step: number): number {
  return step < 1000 ? 1000 : step * 5;
}
