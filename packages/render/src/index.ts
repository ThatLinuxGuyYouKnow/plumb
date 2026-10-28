/** @plumb/render: Canvas2D renderer, drawers, hit-testing, theme. Depends on core only. */
export { createRenderer, type Renderer, type RendererOptions } from './renderer.js';
export { attachViewGestures, type GestureOptions } from './gestures.js';
export { hitTest, nearestWall, wallCoords } from './hit.js';
export { DRAWERS, drawItem, itemOutlinePath, type Drawer } from './drawers.js';
export { draw, type DrawEnv, UI_FONT, MONO_FONT } from './draw.js';
export { gridStep, gridMajor } from './grid.js';
export {
  levelBounds,
  computeFit,
  scaleBarMm,
  scaleReadout,
  zoomedView,
  ZOOM_MIN,
  ZOOM_MAX,
} from './fit.js';
export { layoutRoomLabels } from './labels.js';
export { diffLevels, previewOps, type LevelDiff } from './diff.js';
export { readTheme, watchTheme, type Theme } from './theme.js';
export type {
  PlumbStore,
  RendererState,
  ViewState,
  Selection,
  UiState,
  AgentViewState,
  WallDraft,
  MeasureState,
  Bounds,
} from './types.js';
