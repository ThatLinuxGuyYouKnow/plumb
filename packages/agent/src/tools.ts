/** The six tools exposed to the model (SPEC §9). Zod-validated, pure. */
import { z } from 'zod';
import { nanoid } from 'nanoid';
import {
  applyOps,
  findSpot,
  fmt,
  fmtArea,
  isItemType,
  runChecks,
  type CheckId,
  type Issue,
  type Item,
  type ItemType,
  type Level,
  type Op,
  type Proposal,
} from '@plumb/core';
import { CHECK_IDS } from '@plumb/core';

export const GetPlanSchema = z.object({ detail: z.enum(['summary', 'full']).optional() });
export const RunChecksSchema = z.object({ checks: z.array(z.enum(CHECK_IDS)).optional() });
export const MeasureSchema = z.object({ roomId: z.string().optional(), itemId: z.string().optional() });
export const FindSpaceSchema = z.object({ roomId: z.string(), type: z.string() });
export const HighlightSchema = z.object({
  roomIds: z.array(z.string()).optional(),
  itemIds: z.array(z.string()).optional(),
});
export const ProposeEditSchema = z.object({
  title: z.string().min(1),
  rationale: z.string().optional(),
  /** Loose on purpose: `normalizeOps` accepts an array, a single op object,
   * or a JSON string encoding either — models serialize nested arrays in
   * all of these shapes when tool-call argument escaping goes wrong. */
  ops: z.unknown(),
});

/**
 * Normalize the `ops` argument a model actually sent into an op array.
 * Accepted: an array of op objects; an array of JSON-encoded op strings;
 * a single op object; a JSON string encoding any of those. Returns null
 * only when nothing sensible can be recovered.
 */
function normalizeOps(raw: unknown, depth = 0): Op[] | null {
  if (depth > 2) return null;
  if (typeof raw === 'string') {
    try {
      return normalizeOps(JSON.parse(raw) as unknown, depth + 1);
    } catch {
      return null;
    }
  }
  if (Array.isArray(raw)) {
    const out: Op[] = [];
    for (const el of raw) {
      if (typeof el === 'string') {
        try {
          out.push(JSON.parse(el) as Op);
        } catch {
          // Keep the bad element: applyOps reports it precisely.
          out.push(el as unknown as Op);
        }
      } else {
        out.push(el as Op);
      }
    }
    return out;
  }
  if (typeof raw === 'object' && raw !== null) {
    const o = raw as Record<string, unknown>;
    if (typeof o.op === 'string') return [raw as Op];
    if (Array.isArray(o.ops)) return normalizeOps(o.ops, depth + 1);
  }
  return null;
}

export const TOOL_NAMES = ['get_plan', 'run_checks', 'measure', 'find_space', 'highlight', 'propose_edit'] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name);
}

export interface ToolContext {
  level: Level;
}

export interface ProposeEditResult {
  proposalId: string;
  issuesAfter: Issue[];
  valid: boolean;
  errors?: string[];
  proposal?: Proposal;
}

/** One human line per op for the proposal card. */
export function summarizeOp(op: Op, level: Level, unit: 'm' | 'ft' = 'm'): string {
  const itemLabel = (id: string): string => level.items.find((i) => i.id === id)?.label ?? id;
  switch (op.op) {
    case 'item.add':
      return `Add ${op.item.label} at ${fmt(op.item.x, unit)}, ${fmt(op.item.y, unit)}`;
    case 'item.update': {
      const bits: string[] = [];
      if (op.patch.x !== undefined || op.patch.y !== undefined) {
        const cur = level.items.find((i) => i.id === op.id);
        const nx = op.patch.x ?? cur?.x ?? 0;
        const ny = op.patch.y ?? cur?.y ?? 0;
        bits.push(`to ${fmt(nx, unit)}, ${fmt(ny, unit)}`);
      }
      if (op.patch.rot !== undefined) bits.push(`rotation ${op.patch.rot}°`);
      if (op.patch.w !== undefined || op.patch.d !== undefined) bits.push('new size');
      if (op.patch.label !== undefined) bits.push(`renamed to ${op.patch.label}`);
      return `Move ${itemLabel(op.id)} ${bits.join(', ') || 'update'}`;
    }
    case 'item.remove':
      return `Remove ${itemLabel(op.id)}`;
    case 'wall.add':
      return `Add wall ${op.wall.id}`;
    case 'wall.update':
      return `Move wall ${op.id}`;
    case 'wall.remove':
      return `Remove wall ${op.id}`;
    case 'opening.add':
      return `Add ${op.opening.kind} ${op.opening.id} (${fmt(op.opening.width, unit)} wide)`;
    case 'opening.update':
      return `Update opening ${op.id}`;
    case 'opening.remove':
      return `Remove opening ${op.id}`;
    case 'room.add':
      return `Add room ${op.room.name} (${fmt(op.room.rect.w, unit)} × ${fmt(op.room.rect.h, unit)})`;
    case 'room.remove': {
      const room = level.rooms.find((r) => r.id === op.id);
      return `Remove room ${room?.name ?? op.id}`;
    }
    case 'room.update': {
      const room = level.rooms.find((r) => r.id === op.id);
      const name = room?.name ?? op.id;
      if (op.patch.floor) return `${name} floor: ${room?.floor ?? '?'} → ${op.patch.floor}`;
      if (op.patch.name) return `Rename room to ${op.patch.name}`;
      return `Update ${name}`;
    }
  }
}

export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

function roomOfItem(level: Level, item: Item): string | null {
  const r = level.rooms.find(
    (rm) => item.x >= rm.rect.x && item.x <= rm.rect.x + rm.rect.w && item.y >= rm.rect.y && item.y <= rm.rect.y + rm.rect.h,
  );
  return r ? r.id : null;
}

export function executeTool(name: ToolName, input: unknown, ctx: ToolContext): ToolResult {
  const { level } = ctx;
  switch (name) {
    case 'get_plan': {
      const parsed = GetPlanSchema.safeParse(input ?? {});
      if (!parsed.success) return { ok: false, error: 'get_plan: invalid input' };
      const detail = parsed.data.detail ?? 'summary';
      if (detail === 'full') return { ok: true, data: level };
      return {
        ok: true,
        data: {
          rooms: level.rooms.map((r) => ({ id: r.id, name: r.name, rect: r.rect, finish: r.floor, area: r.rect.w * r.rect.h })),
          items: level.items.map((i) => ({ id: i.id, type: i.type, label: i.label, x: i.x, y: i.y, w: i.w, d: i.d, rot: i.rot, room: roomOfItem(level, i) })),
          openings: level.openings.map((o) => ({ id: o.id, kind: o.kind, wall: o.wall, at: o.at, width: o.width })),
          wallCount: level.walls.length,
        },
      };
    }
    case 'run_checks': {
      const parsed = RunChecksSchema.safeParse(input ?? {});
      if (!parsed.success) return { ok: false, error: 'run_checks: invalid input' };
      const checks = (parsed.data.checks ?? undefined) as readonly CheckId[] | undefined;
      return { ok: true, data: runChecks(level, checks ? { checks } : {}) };
    }
    case 'measure': {
      const parsed = MeasureSchema.safeParse(input ?? {});
      if (!parsed.success) return { ok: false, error: 'measure: invalid input' };
      if (parsed.data.roomId) {
        const r = level.rooms.find((x) => x.id === parsed.data.roomId);
        if (!r) return { ok: false, error: `measure: unknown room ${parsed.data.roomId}` };
        return { ok: true, data: { roomId: r.id, name: r.name, w: r.rect.w, h: r.rect.h, area: r.rect.w * r.rect.h } };
      }
      if (parsed.data.itemId) {
        const i = level.items.find((x) => x.id === parsed.data.itemId);
        if (!i) return { ok: false, error: `measure: unknown item ${parsed.data.itemId}` };
        return { ok: true, data: { itemId: i.id, label: i.label, w: i.w, d: i.d, rot: i.rot } };
      }
      const total = level.rooms.reduce((s, r) => s + r.rect.w * r.rect.h, 0);
      return {
        ok: true,
        data: {
          rooms: level.rooms.map((r) => ({ id: r.id, name: r.name, w: r.rect.w, h: r.rect.h, area: r.rect.w * r.rect.h })),
          total,
        },
      };
    }
    case 'find_space': {
      const parsed = FindSpaceSchema.safeParse(input ?? {});
      if (!parsed.success) return { ok: false, error: 'find_space: invalid input' };
      const room = level.rooms.find((r) => r.id === parsed.data.roomId);
      if (!room) return { ok: false, error: `find_space: unknown room ${parsed.data.roomId}` };
      if (!isItemType(parsed.data.type)) return { ok: false, error: `find_space: unknown type ${parsed.data.type}` };
      const type = parsed.data.type as ItemType;
      const { best, triedCount } = findSpot(room, type, level);
      return { ok: true, data: best ? { ...best, triedCount } : null };
    }
    case 'highlight': {
      const parsed = HighlightSchema.safeParse(input ?? {});
      if (!parsed.success) return { ok: false, error: 'highlight: invalid input' };
      return {
        ok: true,
        data: { ok: true, roomIds: parsed.data.roomIds ?? [], itemIds: parsed.data.itemIds ?? [] },
      };
    }
    case 'propose_edit': {
      const parsed = ProposeEditSchema.safeParse(input ?? {});
      if (!parsed.success) {
        // Tell the model exactly what was wrong so it can self-correct in
        // one round instead of blind retries.
        const detail = parsed.error.issues
          .map((i) => `${i.path.join('.') || 'input'}: ${i.message}`)
          .join('; ');
        return { ok: false, error: `propose_edit: ${detail}` };
      }
      const ops = normalizeOps(parsed.data.ops);
      if (!ops) {
        return {
          ok: false,
          error:
            'propose_edit: ops must be an array of op objects, a single op object, or a JSON string encoding either',
        };
      }
      // Validate ops against the Op schema via applyOps dry-run.
      let after: Level;
      try {
        after = applyOps(level, ops).level;
      } catch (e) {
        const reason = e instanceof Error ? e.message : 'invalid ops';
        const result: ProposeEditResult = { proposalId: '', issuesAfter: [], valid: false, errors: [reason] };
        return { ok: true, data: result };
      }
      const issuesAfter = runChecks(after);
      const id = `p_${nanoid(6)}`;
      const proposal: Proposal = {
        id,
        title: parsed.data.title,
        rationale: parsed.data.rationale,
        ops,
        status: 'pending',
        summary: ops.map((o) => summarizeOp(o, level)),
      };
      const result: ProposeEditResult = { proposalId: id, issuesAfter, valid: true, proposal };
      return { ok: true, data: result };
    }
  }
}

/** Compact plan text sent with every model request (SPEC §9). */
export function compactPlan(level: Level, issues: Issue[], unit: 'm' | 'ft'): string {
  const lines: string[] = [];
  lines.push(`Rooms (${level.rooms.length}):`);
  for (const r of level.rooms) {
    lines.push(`- ${r.name} [${r.id}] ${fmt(r.rect.w, unit)} × ${fmt(r.rect.h, unit)} (${fmtArea(r.rect.w * r.rect.h, unit)}), floor ${r.floor}`);
  }
  lines.push(`Items (${level.items.length}):`);
  for (const i of level.items) {
    lines.push(`- ${i.label} [${i.id}/${i.type}] at ${fmt(i.x, unit)}, ${fmt(i.y, unit)}, ${fmt(i.w, unit)} × ${fmt(i.d, unit)}, rot ${i.rot}°`);
  }
  lines.push(`Openings (${level.openings.length}), walls (${level.walls.length}).`);
  lines.push(issues.length ? `Open issues (${issues.length}): ${issues.map((x) => x.message).join('; ')}` : 'Open issues: none.');
  return lines.join('\n');
}
