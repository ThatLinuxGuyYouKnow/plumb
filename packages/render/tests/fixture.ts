import fixtureJson from '../../../fixtures/twoBed.plan.json';
import { PlanSchema, type Level } from '@plumb/core';

export function loadLevel(): Level {
  const plan = PlanSchema.parse(fixtureJson);
  const level = plan.levels[0];
  if (!level) throw new Error('fixture has no levels');
  return level;
}

export function loadView(): { x: number; y: number; s: number } {
  // Approximation of the prototype's fit at 1200×800: near s = 0.067.
  return { x: 5000 - 600 / 0.0673, y: 3800 - 323 / 0.0673, s: 0.0673 };
}
