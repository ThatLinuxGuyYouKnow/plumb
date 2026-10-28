/**
 * Deterministic fallback agent: ports the prototype's regex intents onto the
 * real op system. Used when no API key is configured, when the network fails,
 * and in all tests (SPEC §9).
 */
import { nanoid } from 'nanoid';
import {
  CATALOG,
  FINISH_LABELS,
  conflictsOf,
  findSpot,
  fmt,
  fmtArea,
  hasConflict,
  isItemType,
  runChecks,
  suggestNudge,
  type Finish,
  type Item,
  type ItemType,
  type Level,
  type Op,
  type Proposal,
  type Room,
} from '@plumb/core';
import { DEFAULT_CHIPS, type Agent, type AgentContext, type AgentEvent } from './types.js';

const FINISH_WORDS: Array<[Finish, RegExp]> = [
  ['timber', /\boak\b|\btimber\b|\bwood\b/],
  ['tile', /\btile\b|\bporcelain\b|\bceramic\b/],
  ['carpet', /\bcarpet\b/],
  ['stone', /\bterrazzo\b|\bstone\b|\bmarble\b/],
];

function norm(s: string): string {
  return s.toLowerCase();
}

function escRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word (or whole-phrase) match: `bed` must not fire inside `bedroom`. */
function hasWord(text: string, word: string): boolean {
  return new RegExp(`\\b${escRe(norm(word))}\\b`).test(text);
}

function words(s: string): string[] {
  return norm(s).split(/[^a-z0-9]+/).filter(Boolean);
}

function findRoom(text: string, level: Level): Room | null {
  const t = norm(text);
  let best: Room | null = null;
  let bestScore = 0;
  for (const r of level.rooms) {
    const name = norm(r.name);
    if (t.includes(name)) return r;
    const ws = words(r.name).filter((w) => w !== '&' && w !== 'the');
    const score = ws.filter((w) => t.includes(w)).length;
    // Require at least the distinctive words: "bedroom 1" needs both.
    if (score > bestScore && score >= ws.length - 1 && score > 0) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

function findItem(text: string, level: Level): Item | null {
  const t = norm(text);
  let best: Item | null = null;
  let bestScore = 0;
  for (const item of level.items) {
    const label = norm(item.label);
    if (t.includes(label)) return item;
    const ws = words(item.label);
    const score = ws.filter((w) => w.length > 2 && hasWord(t, w)).length;
    const entry = CATALOG[item.type];
    const syn = entry.synonyms.some((s) => hasWord(t, s)) ? 1 : 0;
    if (score + syn > bestScore) {
      bestScore = score + syn;
      best = item;
    }
  }
  return bestScore > 0 ? best : null;
}

function findCat(text: string): ItemType | null {
  const t = norm(text);
  for (const [type, entry] of Object.entries(CATALOG)) {
    if (!isItemType(type)) continue;
    if (hasWord(t, entry.label) || entry.synonyms.some((s) => hasWord(t, s))) return type;
  }
  return null;
}

function roomOfItem(item: Item, level: Level): Room | null {
  const r = level.rooms.find(
    (rm) => item.x >= rm.rect.x && item.x <= rm.rect.x + rm.rect.w && item.y >= rm.rect.y && item.y <= rm.rect.y + rm.rect.h,
  );
  return r ?? null;
}

function* steps(names: string[]): Generator<AgentEvent> {
  for (const name of names) {
    const [stepName, summary] = name.split('·').map((s) => s.trim());
    yield { type: 'step', name: stepName ?? name, summary: summary ?? '', status: 'run' };
    yield { type: 'step', name: stepName ?? name, summary: summary ?? '', status: 'done' };
  }
}

function mkProposal(title: string, ops: Op[], summary: string[], rationale?: string): Proposal {
  return { id: `p_${nanoid(6)}`, title, rationale, ops, status: 'pending', summary };
}

function dirText(dx: number, dy: number): string {
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'east' : 'west';
  return dy > 0 ? 'south' : 'north';
}

function parseDistance(text: string, unit: 'm' | 'ft'): number {
  const m = text.match(/(\d+(?:\.\d+)?)\s*(mm|cm|\bm\b|ft|feet|foot|in|")?\b/);
  if (!m || m[1] === undefined) return 500;
  const v = parseFloat(m[1]);
  const u = m[2] ?? (unit === 'm' ? 'm' : 'ft');
  if (u === 'mm') return v;
  if (u === 'cm') return v * 10;
  if (u === 'm') return v * 1000;
  if (u === 'in' || u === '"') return v * 25.4;
  return v * 304.8;
}

const DIRS: Record<string, [number, number]> = {
  north: [0, -1],
  up: [0, -1],
  top: [0, -1],
  south: [0, 1],
  down: [0, 1],
  bottom: [0, 1],
  east: [1, 0],
  right: [1, 0],
  west: [-1, 0],
  left: [-1, 0],
};

export class FallbackAgent implements Agent {
  async *respond(text: string, ctx: AgentContext): AsyncIterable<AgentEvent> {
    const t = norm(text);
    if (/^(hi|hello|hey|help|what can you)/.test(t) || /what can you/.test(t)) {
      yield* this.help(true);
    } else if (/^(undo|revert)|undo that|undo the last/.test(t)) {
      if (ctx.canUndo) {
        yield* steps(['restore_snapshot']);
        yield { type: 'undo-request' };
        yield { type: 'text', delta: 'Undid the last change.' };
        yield { type: 'chips', chips: DEFAULT_CHIPS };
      } else {
        yield { type: 'text', delta: 'There is nothing to undo.' };
      }
    } else if (/\b(remove|delete|get rid)\b/.test(t)) {
      yield* this.remove(t, ctx);
    } else if (/\b(rotate|turn|flip)\b/.test(t)) {
      yield* this.rotate(t, ctx);
    } else if (/\b(add|put|place|insert|drop|furnish)\b/.test(t)) {
      yield* this.add(t, ctx);
    } else if (/\b(move|shift|push|slide|nudge|pull)\b/.test(t)) {
      yield* this.move(t, ctx);
    } else if (/floor|flooring|\btile\b|\btimber\b|\boak\b|\bcarpet\b|\bmarble\b|\bterrazzo\b/.test(t) && !/\brug\b/.test(t)) {
      yield* this.floor(t, ctx);
    } else if (/check|clearance|issue|audit|conflict|review|problem|swing|collision/.test(t)) {
      yield* this.check(ctx);
    } else if (/area|how big|how large|\bsize\b|square|sqm|how wide|how long|dimension|show areas/.test(t)) {
      yield* this.areas(t, ctx);
    } else {
      yield* this.help(false);
    }
    yield { type: 'done' };
  }

  private *help(greet: boolean): Generator<AgentEvent> {
    yield {
      type: 'text',
      delta:
        (greet ? 'Hi. ' : 'I did not catch that. ') +
        'I can check door swings and overlaps, report room areas, add or move furniture, rotate or remove pieces and change floors. ' +
        'Anything that edits the plan comes back as a proposal you can apply or dismiss.',
    };
    yield { type: 'chips', chips: DEFAULT_CHIPS };
  }

  private *check(ctx: AgentContext): Generator<AgentEvent> {
    const { level } = ctx;
    const pieces = level.items.filter((i) => i.type !== 'rug').length;
    yield* steps([
      `scan_doors · ${level.openings.filter((o) => o.kind === 'door').length} swings`,
      `scan_overlaps · ${pieces} pieces`,
      `scan_walls · ${level.rooms.length} rooms`,
    ]);
    const issues = runChecks(level);
    if (!issues.length) {
      yield {
        type: 'text',
        delta: 'No conflicts. Every door swing is clear, nothing overlaps and each piece sits inside its room.',
      };
      yield { type: 'chips', chips: DEFAULT_CHIPS };
      return;
    }
    yield {
      type: 'text',
      delta:
        `Found ${issues.length} issue${issues.length > 1 ? 's' : ''}:\n` +
        issues.map((i, n) => `${n + 1} · ${i.message}`).join('\n'),
    };
    const seen = new Set<string>();
    const marks: Array<{ x: number; y: number }> = [];
    for (const issue of issues) {
      const item = level.items.find((x) => x.id === issue.itemIds[0]);
      if (item && !seen.has(item.id)) {
        seen.add(item.id);
        marks.push({ x: item.x, y: item.y });
      }
    }
    if (marks.length) yield { type: 'marks', marks };
    const firstItem = level.items.find((x) => x.id === issues[0]?.itemIds[0]);
    if (firstItem) {
      const fix = suggestNudge(firstItem, level);
      if (fix) {
        const dx = fix.x - firstItem.x;
        const dy = fix.y - firstItem.y;
        const dist = Math.hypot(dx, dy);
        const ops: Op[] = [{ op: 'item.update', id: firstItem.id, patch: { x: fix.x, y: fix.y } }];
        yield {
          type: 'text',
          delta: `\nSmallest fix: move the ${firstItem.label.toLowerCase()} ${fmt(dist, ctx.unit)} ${dirText(dx, dy)}. It clears the arc and keeps the piece against its wall. Apply it from the card below, or drag the piece yourself.`,
        };
        yield {
          type: 'proposal',
          proposal: mkProposal(`Move ${firstItem.label} ${dirText(dx, dy)}`, ops, [
            `Move ${firstItem.label} to ${fmt(fix.x, ctx.unit)}, ${fmt(fix.y, ctx.unit)}`,
          ]),
        };
      } else {
        yield { type: 'text', delta: 'I could not find a nearby spot that clears it. Try dragging it to another wall.' };
      }
    }
    yield { type: 'chips', chips: ['Show areas', 'Add a plant to Bedroom 2', 'Swap Bedroom 1 floor to oak'] };
  }

  private *areas(text: string, ctx: AgentContext): Generator<AgentEvent> {
    const { level } = ctx;
    const room = findRoom(text, level);
    if (room) {
      yield* steps([`measure_room · ${room.name}`]);
      yield {
        type: 'text',
        delta: `${room.name} is ${fmt(room.rect.w, ctx.unit)} by ${fmt(room.rect.h, ctx.unit)}, ${fmtArea(room.rect.w * room.rect.h, ctx.unit)} net (inside the finished walls).`,
      };
      yield { type: 'flash', roomIds: [room.id] };
      yield { type: 'chips', chips: DEFAULT_CHIPS };
      return;
    }
    yield* steps([`measure_rooms · ${level.rooms.length}`, 'sum_net_area']);
    const rows = level.rooms.map((r) => [r.name, `${fmt(r.rect.w, ctx.unit)} × ${fmt(r.rect.h, ctx.unit)}`, fmtArea(r.rect.w * r.rect.h, ctx.unit)]);
    const total = level.rooms.reduce((s, r) => s + r.rect.w * r.rect.h, 0);
    rows.push(['Total net', '', fmtArea(total, ctx.unit)]);
    yield { type: 'text', delta: 'Net areas, measured inside the finished walls:' };
    yield { type: 'table', rows };
    yield { type: 'flash', roomIds: level.rooms.map((r) => r.id) };
    yield { type: 'chips', chips: DEFAULT_CHIPS };
  }

  private *floor(text: string, ctx: AgentContext): Generator<AgentEvent> {
    const { level } = ctx;
    const room =
      findRoom(text, level) ??
      (ctx.selection?.type === 'room' ? (level.rooms.find((r) => r.id === ctx.selection?.id) ?? null) : null);
    const found = FINISH_WORDS.find(([, re]) => re.test(text));
    if (!room) {
      yield { type: 'text', delta: 'Which room should get the new floor?' };
      yield { type: 'chips', chips: level.rooms.map((r) => `Make the ${r.name} floor ${found ? FINISH_LABELS[found[0]].toLowerCase() : 'oak'}`) };
      return;
    }
    if (!found) {
      yield { type: 'text', delta: `Which finish for the ${room.name} floor? I have oak timber, porcelain tile, carpet and terrazzo.` };
      yield { type: 'chips', chips: (Object.keys(FINISH_LABELS) as Finish[]).map((f) => `${room.name} floor to ${FINISH_LABELS[f].toLowerCase()}`) };
      return;
    }
    if (room.floor === found[0]) {
      yield* steps([`read_room · ${room.name}`]);
      yield { type: 'text', delta: `${room.name} already has ${FINISH_LABELS[found[0]].toLowerCase()}.` };
      return;
    }
    yield* steps([`read_room · ${room.name}`, `preview_floor · ${FINISH_LABELS[found[0]]}`]);
    yield { type: 'text', delta: `Previewing ${FINISH_LABELS[found[0]].toLowerCase()} in the ${room.name} on the plan.` };
    const ops: Op[] = [{ op: 'room.update', id: room.id, patch: { floor: found[0] } }];
    yield {
      type: 'proposal',
      proposal: mkProposal(`${room.name} floor to ${FINISH_LABELS[found[0]]}`, ops, [
        `${room.name} floor: ${FINISH_LABELS[room.floor]} → ${FINISH_LABELS[found[0]]}`,
      ]),
    };
    yield { type: 'chips', chips: DEFAULT_CHIPS };
  }

  private *add(text: string, ctx: AgentContext): Generator<AgentEvent> {
    const { level } = ctx;
    const type = findCat(text);
    if (!type) {
      yield { type: 'text', delta: 'Which piece? I can place beds, sofas, desks, wardrobes, tables, rugs, plants and the rest of the library.' };
      yield { type: 'chips', chips: ['Add a desk to Bedroom 1', 'Add a plant to the living room'] };
      return;
    }
    const entry = CATALOG[type];
    let room = findRoom(text, level);
    if (!room && ctx.selection?.type === 'item') {
      const sel = level.items.find((i) => i.id === ctx.selection?.id);
      room = sel ? roomOfItem(sel, level) : null;
    }
    if (!room) {
      yield { type: 'text', delta: `Which room should the ${entry.label.toLowerCase()} go in?` };
      yield { type: 'chips', chips: level.rooms.map((r) => `Add ${/^[aeiou]/i.test(entry.label) ? 'an' : 'a'} ${entry.label.toLowerCase()} to ${r.name}`) };
      return;
    }
    yield* steps([`find_space · ${room.name}`, 'test_clearances']);
    const { best, triedCount } = findSpot(room, type, level);
    yield { type: 'text', delta: `Tested ${triedCount} positions in the ${room.name}.` };
    if (!best) {
      yield { type: 'text', delta: `\nThere is no clear spot for a ${entry.label.toLowerCase()} in the ${room.name} without crossing a door swing or another piece.` };
      yield { type: 'chips', chips: DEFAULT_CHIPS };
      return;
    }
    const item: Item = { id: `i_${nanoid(6)}`, type, label: entry.label, x: best.x, y: best.y, w: entry.w, d: entry.d, rot: best.rot };
    yield {
      type: 'text',
      delta: entry.wallBacked
        ? `Best spot is against the ${['north', 'east', 'south', 'west'][best.rot / 90] ?? ''} wall of the ${room.name}, as far from the door as it will go.`
        : `Centred in the ${room.name} with clear floor around it.`,
    };
    const ops: Op[] = [{ op: 'item.add', item }];
    yield {
      type: 'proposal',
      proposal: mkProposal(`Add ${entry.label} to ${room.name}`, ops, [
        `Add ${entry.label} at ${fmt(best.x, ctx.unit)}, ${fmt(best.y, ctx.unit)}`,
      ]),
    };
    yield { type: 'chips', chips: DEFAULT_CHIPS };
  }

  private *move(text: string, ctx: AgentContext): Generator<AgentEvent> {
    const { level } = ctx;
    const item = findItem(text, level);
    if (!item) {
      yield { type: 'text', delta: 'Which piece should I move? Name it, or select it on the plan first.' };
      return;
    }
    const room = roomOfItem(item, level);
    let x = item.x;
    let y = item.y;
    const against = text.match(/against (?:the )?(north|south|east|west|left|right|top|bottom)/);
    if (/cent(er|re)/.test(text) && room) {
      x = room.rect.x + room.rect.w / 2;
      y = room.rect.y + room.rect.h / 2;
    } else if (against && against[1] && room) {
      const dv = DIRS[against[1]];
      if (dv) {
        // Push the item's box against the room edge.
        const { w, d, rot } = item;
        const rotM = ((rot % 180) + 180) % 180 !== 0;
        const hw = (rotM ? d : w) / 2;
        const hd = (rotM ? w : d) / 2;
        if (dv[0] === 1) x = room.rect.x + room.rect.w - hw;
        else if (dv[0] === -1) x = room.rect.x + hw;
        else if (dv[1] === 1) y = room.rect.y + room.rect.h - hd;
        else y = room.rect.y + hd;
      }
    } else {
      const dm = text.match(/\b(north|south|east|west|up|down|left|right)\b/);
      if (!dm || !dm[1]) {
        yield { type: 'text', delta: 'Which way? For example "move the sofa 0.5 m east" or "push the desk against the north wall".' };
        return;
      }
      const dv = DIRS[dm[1]];
      if (!dv) {
        yield { type: 'text', delta: 'Which way? For example "move the sofa 0.5 m east".' };
        return;
      }
      const dist = parseDistance(text, ctx.unit);
      x += dv[0] * dist;
      y += dv[1] * dist;
    }
    x = Math.round(x / 10) * 10;
    y = Math.round(y / 10) * 10;
    if (x === item.x && y === item.y) {
      yield* steps([`locate · ${item.label}`]);
      yield { type: 'text', delta: `The ${item.label.toLowerCase()} is already there.` };
      return;
    }
    yield* steps([`locate · ${item.label}`, 'test_clearances · new position']);
    const cf = conflictsOf(level, { ...item, x, y });
    const note = hasConflict(cf)
      ? ` Heads up: that spot ${cf.swings.length ? 'is inside a door swing' : cf.overlaps.length ? `overlaps ${cf.overlaps[0]?.label ?? 'another piece'}` : 'runs past the wall'}.`
      : ' That position is clear of door swings and other pieces.';
    yield { type: 'text', delta: `Previewing the move on the plan.${note}` };
    const ops: Op[] = [{ op: 'item.update', id: item.id, patch: { x, y } }];
    yield {
      type: 'proposal',
      proposal: mkProposal(`Move ${item.label} to ${fmt(x, ctx.unit)}, ${fmt(y, ctx.unit)}`, ops, [
        `Move ${item.label} to ${fmt(x, ctx.unit)}, ${fmt(y, ctx.unit)}`,
      ]),
    };
    yield { type: 'chips', chips: DEFAULT_CHIPS };
  }

  private *rotate(text: string, ctx: AgentContext): Generator<AgentEvent> {
    const { level } = ctx;
    const item = findItem(text, level);
    if (!item) {
      yield { type: 'text', delta: 'Which piece should I rotate? Name it, or select it first.' };
      return;
    }
    const by = /180|around|flip/.test(text) ? 180 : /counter|anti|left/.test(text) ? 270 : 90;
    const rot = (item.rot + by) % 360;
    yield* steps([`locate · ${item.label}`]);
    const cf = conflictsOf(level, { ...item, rot });
    yield {
      type: 'text',
      delta: `Turning the ${item.label.toLowerCase()} ${by}°.${hasConflict(cf) ? ' It will clash with something at that angle.' : ' Nothing is in its way.'}`,
    };
    const ops: Op[] = [{ op: 'item.update', id: item.id, patch: { rot } }];
    yield {
      type: 'proposal',
      proposal: mkProposal(`Rotate ${item.label} ${by}°`, ops, [`Rotate ${item.label} to ${rot}°`]),
    };
    yield { type: 'chips', chips: DEFAULT_CHIPS };
  }

  private *remove(text: string, ctx: AgentContext): Generator<AgentEvent> {
    const { level } = ctx;
    const item = findItem(text, level);
    if (!item) {
      yield { type: 'text', delta: 'Which piece should I remove?' };
      return;
    }
    yield* steps([`locate · ${item.label}`]);
    yield { type: 'text', delta: 'Marked for removal on the plan.' };
    const room = roomOfItem(item, level);
    const ops: Op[] = [{ op: 'item.remove', id: item.id }];
    yield {
      type: 'proposal',
      proposal: mkProposal(`Remove ${item.label}`, ops, [`Remove ${item.label} from ${room?.name ?? 'plan'}`]),
    };
    yield { type: 'chips', chips: DEFAULT_CHIPS };
  }
}
