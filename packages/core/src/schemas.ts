/**
 * Domain model: Zod schemas are the single source of truth for types
 * (`z.infer`). All lengths are millimetres. Coordinates are y-down,
 * angles are clockwise degrees. See SPEC §4.
 */
import { z } from 'zod';
import { FINISHES, ITEM_TYPES } from './catalog.js';

export { FINISHES };
export type { Finish, ItemType } from './catalog.js';

export const IdSchema = z.string().min(1);
export type Id = z.infer<typeof IdSchema>;

export const MmSchema = z.number().finite();
export type Mm = z.infer<typeof MmSchema>;

export const VecSchema = z.tuple([MmSchema, MmSchema]);
export type Vec = z.infer<typeof VecSchema>;

export const ItemTypeSchema = z.enum(ITEM_TYPES);

export const WallSchema = z.object({
  id: IdSchema,
  a: VecSchema,
  b: VecSchema,
  thickness: MmSchema,
});
export type Wall = z.infer<typeof WallSchema>;

const OpeningBaseSchema = z.object({
  id: IdSchema,
  wall: IdSchema,
  /** Distance along the wall from `a` to the opening centre. */
  at: MmSchema,
  width: MmSchema,
});

export const DoorSchema = OpeningBaseSchema.extend({
  kind: z.literal('door'),
  /** +1 swings to the +n side, -1 to the -n side. */
  swing: z.union([z.literal(1), z.literal(-1)]),
  /** Which end of the opening carries the hinge. */
  hinge: z.enum(['a', 'b']),
});
export type Door = z.infer<typeof DoorSchema>;

export const WindowSchema = OpeningBaseSchema.extend({
  kind: z.literal('window'),
});
export type Window = z.infer<typeof WindowSchema>;

export const OpeningSchema = z.discriminatedUnion('kind', [DoorSchema, WindowSchema]);
export type Opening = z.infer<typeof OpeningSchema>;

export const RoomRectSchema = z.object({
  x: MmSchema,
  y: MmSchema,
  w: MmSchema,
  h: MmSchema,
});
export type RoomRect = z.infer<typeof RoomRectSchema>;

export const RoomSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  rect: RoomRectSchema,
  floor: z.enum(FINISHES),
});
export type Room = z.infer<typeof RoomSchema>;

export const ItemSchema = z.object({
  id: IdSchema,
  type: ItemTypeSchema,
  label: z.string().min(1),
  x: MmSchema,
  y: MmSchema,
  w: MmSchema,
  d: MmSchema,
  /** Clockwise degrees. Back faces north at 0, east at 90, south at 180, west at 270. */
  rot: z.number().finite(),
});
export type Item = z.infer<typeof ItemSchema>;

export const LevelSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  walls: z.array(WallSchema),
  openings: z.array(OpeningSchema),
  rooms: z.array(RoomSchema),
  items: z.array(ItemSchema),
});
export type Level = z.infer<typeof LevelSchema>;

export const PlanSchema = z.object({
  schemaVersion: z.literal(1),
  id: IdSchema,
  name: z.string(),
  levels: z.array(LevelSchema).min(1),
});
export type Plan = z.infer<typeof PlanSchema>;

// ---------------------------------------------------------------------------
// Operations (SPEC §5)
// ---------------------------------------------------------------------------

export const ItemAddOpSchema = z.object({ op: z.literal('item.add'), item: ItemSchema });
export const ItemUpdateOpSchema = z.object({
  op: z.literal('item.update'),
  id: IdSchema,
  patch: ItemSchema.pick({ x: true, y: true, w: true, d: true, rot: true, label: true }).partial(),
});
export const ItemRemoveOpSchema = z.object({ op: z.literal('item.remove'), id: IdSchema });

export const WallAddOpSchema = z.object({ op: z.literal('wall.add'), wall: WallSchema });
export const WallUpdateOpSchema = z.object({
  op: z.literal('wall.update'),
  id: IdSchema,
  patch: WallSchema.pick({ a: true, b: true, thickness: true }).partial(),
});
export const WallRemoveOpSchema = z.object({ op: z.literal('wall.remove'), id: IdSchema });

export const OpeningAddOpSchema = z.object({ op: z.literal('opening.add'), opening: OpeningSchema });
export const OpeningUpdateOpSchema = z.object({
  op: z.literal('opening.update'),
  id: IdSchema,
  patch: z.object({
    at: MmSchema,
    width: MmSchema,
    swing: z.union([z.literal(1), z.literal(-1)]),
    hinge: z.enum(['a', 'b']),
  }).partial(),
});
export const OpeningRemoveOpSchema = z.object({ op: z.literal('opening.remove'), id: IdSchema });

export const RoomAddOpSchema = z.object({ op: z.literal('room.add'), room: RoomSchema });
export const RoomRemoveOpSchema = z.object({ op: z.literal('room.remove'), id: IdSchema });

export const RoomUpdateOpSchema = z.object({
  op: z.literal('room.update'),
  id: IdSchema,
  patch: RoomSchema.pick({ name: true, floor: true, rect: true }).partial(),
});

export const OpSchema = z.discriminatedUnion('op', [
  ItemAddOpSchema,
  ItemUpdateOpSchema,
  ItemRemoveOpSchema,
  WallAddOpSchema,
  WallUpdateOpSchema,
  WallRemoveOpSchema,
  OpeningAddOpSchema,
  OpeningUpdateOpSchema,
  OpeningRemoveOpSchema,
  RoomAddOpSchema,
  RoomRemoveOpSchema,
  RoomUpdateOpSchema,
]);
export type Op = z.infer<typeof OpSchema>;

export const OpSourceSchema = z.enum(['user', 'agent', 'import']);
export type OpSource = z.infer<typeof OpSourceSchema>;

export const HistoryEntrySchema = z.object({
  id: IdSchema,
  label: z.string(),
  ops: z.array(OpSchema),
  inverse: z.array(OpSchema),
  source: OpSourceSchema,
});
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

export const ProposalStatusSchema = z.enum(['pending', 'applied', 'dismissed', 'superseded', 'undone']);
export type ProposalStatus = z.infer<typeof ProposalStatusSchema>;

export const ProposalSchema = z.object({
  id: IdSchema,
  title: z.string().min(1),
  rationale: z.string().optional(),
  ops: z.array(OpSchema),
  status: ProposalStatusSchema,
  summary: z.array(z.string()),
});
export type Proposal = z.infer<typeof ProposalSchema>;

// ---------------------------------------------------------------------------
// Checks (SPEC §6)
// ---------------------------------------------------------------------------

export const CHECK_IDS = ['door-swing', 'overlap', 'outside-room', 'passage', 'window-blocked'] as const;
export type CheckId = (typeof CHECK_IDS)[number];

export const CheckIdSchema = z.enum(CHECK_IDS);

export const IssueSchema = z.object({
  id: z.string().min(1),
  check: CheckIdSchema,
  severity: z.enum(['error', 'warn']),
  itemIds: z.array(IdSchema),
  at: VecSchema,
  message: z.string().min(1),
});
export type Issue = z.infer<typeof IssueSchema>;

export const CheckConfigSchema = z.object({
  /** Clear width below which a doorway approach warns. */
  minPassage: z.number().finite().positive(),
});
export type CheckConfig = z.infer<typeof CheckConfigSchema>;

export const DEFAULT_CHECK_CONFIG: CheckConfig = { minPassage: 900 };
