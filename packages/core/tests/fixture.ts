import fixtureJson from '../../../fixtures/twoBed.plan.json';
import { PlanSchema, type Level } from '../src/schemas.js';

/** Parse the twoBed fixture through the Zod schema (validates the JSON too). */
export function loadLevel(): Level {
  const plan = PlanSchema.parse(fixtureJson);
  const level = plan.levels[0];
  if (!level) throw new Error('fixture has no levels');
  return level;
}
