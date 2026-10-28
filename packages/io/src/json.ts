/**
 * Native `.plumb.json` format: `{ schemaVersion, plan }`.
 * Parse with Zod, run `migrate` n → n+1 until current.
 */
import { z } from 'zod';
import { PlanSchema, type Level, type Plan } from '@plumb/core';

export const CURRENT_SCHEMA_VERSION = 1;

const PlumbFileSchema = z.object({
  schemaVersion: z.number().int(),
  plan: z.unknown(),
});
export type PlumbFile = { schemaVersion: number; plan: Plan };

/** Migrate a parsed plan document forward. Add `n → n+1` functions here. */
export function migrate(doc: { schemaVersion: number; plan: unknown }): { schemaVersion: number; plan: Plan } {
  let version = doc.schemaVersion;
  let plan = doc.plan as Plan;
  // v0 → v1: levels gained ids, items gained labels. Fill defensively.
  if (version === 0) {
    const raw = plan as unknown as { name?: string; levels: Array<Partial<Level>> };
    plan = {
      schemaVersion: 1,
      id: 'plan_migrated',
      name: raw.name ?? 'Migrated plan',
      levels: raw.levels.map((l, i) => ({
        id: `level_${i}`,
        name: `Level ${i + 1}`,
        walls: l.walls ?? [],
        openings: l.openings ?? [],
        rooms: l.rooms ?? [],
        items: (l.items ?? []).map((it, j) => ({ label: `Item ${j + 1}`, ...(it as object) })),
      })),
    } as Plan;
    version = 1;
  }
  while (version < CURRENT_SCHEMA_VERSION) {
    // Future migrations go here (n → n+1).
    version += 1;
  }
  return { schemaVersion: version, plan };
}

/** Parse and validate a `.plumb.json` string. Throws on invalid input. */
export function parsePlumbFile(text: string): PlumbFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error('Not valid JSON');
  }
  const file = PlumbFileSchema.parse(raw);
  const migrated = migrate({ schemaVersion: file.schemaVersion, plan: file.plan });
  const plan = PlanSchema.parse(migrated.plan);
  return { schemaVersion: migrated.schemaVersion, plan };
}

/** Serialise a plan to `.plumb.json`. Round-trips through `parsePlumbFile`. */
export function serializePlumbFile(plan: Plan): string {
  const checked = PlanSchema.parse(plan);
  return JSON.stringify({ schemaVersion: CURRENT_SCHEMA_VERSION, plan: checked }, null, 2);
}
