import { describe, expect, it } from 'vitest';
import fixtureJson from '../../../fixtures/twoBed.plan.json';
import { PlanSchema } from '../src/schemas.js';

describe('native format round trip (SPEC §11)', () => {
  it('parses the fixture losslessly', () => {
    const plan = PlanSchema.parse(fixtureJson);
    expect(plan).toEqual(fixtureJson);
  });

  it('parse(serialize(plan)) deep-equals plan', () => {
    const plan = PlanSchema.parse(fixtureJson);
    const revived = PlanSchema.parse(JSON.parse(JSON.stringify(plan)));
    expect(revived).toEqual(plan);
  });
});
