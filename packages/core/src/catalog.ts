/** Room floor finishes. */
export const FINISHES = ['timber', 'tile', 'carpet', 'stone'] as const;
export type Finish = (typeof FINISHES)[number];

/** Display names for finishes (agent copy, ghost labels). */
export const FINISH_LABELS: Record<Finish, string> = {
  timber: 'Oak timber',
  tile: 'Porcelain tile',
  carpet: 'Carpet',
  stone: 'Terrazzo',
};

/** Furniture catalogue: default dimensions (mm) and placement behaviour. Pure data. */

export const ITEM_TYPES = [
  'bed',
  'nightstand',
  'wardrobe',
  'dresser',
  'sofa',
  'armchair',
  'coffee',
  'tv',
  'dining',
  'desk',
  'rug',
  'plant',
  'bathtub',
  'toilet',
  'vanity',
  'counter',
  'cooktop',
  'sinkunit',
  'fridge',
  'island',
] as const;

export type ItemType = (typeof ITEM_TYPES)[number];

export interface CatalogEntry {
  type: ItemType;
  label: string;
  /** Default width (local x) in mm. */
  w: number;
  /** Default depth (local y) in mm. */
  d: number;
  /** True when the piece is normally placed with its back against a wall. */
  wallBacked: boolean;
  /** Name synonyms used for matching (DXF import, agent language). */
  synonyms: readonly string[];
}

export const CATALOG: Record<ItemType, CatalogEntry> = {
  bed: { type: 'bed', label: 'Queen bed', w: 1600, d: 2050, wallBacked: true, synonyms: ['bed'] },
  nightstand: {
    type: 'nightstand',
    label: 'Nightstand',
    w: 450,
    d: 400,
    wallBacked: true,
    synonyms: ['nightstand', 'night stand', 'bedside', 'side table'],
  },
  wardrobe: {
    type: 'wardrobe',
    label: 'Wardrobe',
    w: 1800,
    d: 600,
    wallBacked: true,
    synonyms: ['wardrobe', 'closet'],
  },
  dresser: {
    type: 'dresser',
    label: 'Dresser',
    w: 1200,
    d: 450,
    wallBacked: true,
    synonyms: ['dresser', 'chest of drawers'],
  },
  sofa: { type: 'sofa', label: 'Sofa', w: 2200, d: 950, wallBacked: true, synonyms: ['sofa', 'couch'] },
  armchair: {
    type: 'armchair',
    label: 'Armchair',
    w: 850,
    d: 850,
    wallBacked: true,
    synonyms: ['armchair', 'arm chair', 'lounge chair', 'chair'],
  },
  coffee: {
    type: 'coffee',
    label: 'Coffee table',
    w: 1200,
    d: 600,
    wallBacked: false,
    synonyms: ['coffee table'],
  },
  tv: {
    type: 'tv',
    label: 'TV unit',
    w: 1600,
    d: 400,
    wallBacked: true,
    synonyms: ['tv', 'television', 'media unit'],
  },
  dining: {
    type: 'dining',
    label: 'Dining table (6)',
    w: 2200,
    d: 1500,
    wallBacked: false,
    synonyms: ['dining'],
  },
  desk: {
    type: 'desk',
    label: 'Desk',
    w: 1400,
    d: 600,
    wallBacked: true,
    synonyms: ['desk', 'workstation', 'work space'],
  },
  rug: { type: 'rug', label: 'Rug', w: 2400, d: 3000, wallBacked: false, synonyms: ['rug'] },
  plant: {
    type: 'plant',
    label: 'Plant',
    w: 500,
    d: 500,
    wallBacked: true,
    synonyms: ['plant', 'tree', 'fiddle'],
  },
  bathtub: {
    type: 'bathtub',
    label: 'Bathtub',
    w: 1700,
    d: 750,
    wallBacked: true,
    synonyms: ['bathtub', 'bath tub', 'tub'],
  },
  toilet: { type: 'toilet', label: 'Toilet', w: 400, d: 700, wallBacked: true, synonyms: ['toilet', 'wc'] },
  vanity: {
    type: 'vanity',
    label: 'Vanity',
    w: 600,
    d: 450,
    wallBacked: true,
    synonyms: ['vanity', 'wash basin', 'basin'],
  },
  counter: {
    type: 'counter',
    label: 'Counter',
    w: 2400,
    d: 600,
    wallBacked: true,
    synonyms: ['counter', 'worktop'],
  },
  cooktop: {
    type: 'cooktop',
    label: 'Cooktop run',
    w: 2600,
    d: 600,
    wallBacked: true,
    synonyms: ['cooktop', 'cook top', 'hob', 'cooker'],
  },
  sinkunit: { type: 'sinkunit', label: 'Sink unit', w: 2300, d: 600, wallBacked: true, synonyms: ['sink'] },
  fridge: {
    type: 'fridge',
    label: 'Fridge',
    w: 700,
    d: 700,
    wallBacked: true,
    synonyms: ['fridge', 'refrigerator'],
  },
  island: { type: 'island', label: 'Island', w: 1800, d: 900, wallBacked: false, synonyms: ['island'] },
};

/** Items tall enough to block a window. */
export const TALL_TYPES: readonly ItemType[] = ['wardrobe', 'fridge'];

export function isItemType(value: string): value is ItemType {
  return (ITEM_TYPES as readonly string[]).includes(value);
}
