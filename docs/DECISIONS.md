# Decisions

Date, decision, reason. Per SPEC §16.8.

## 2026-10-09 — Client agent: 150 s budget and no sticky server-unreachable flag

The next live run fell to the local fallback with no server log line at all:
the request never left the browser. Two web-client bugs. (1) `client.ts`
aborted every agent request at 35 s — after the server budget went to 150 s,
the client kill became the effective ceiling, aborting multi-round builds
mid-stream into the fallback. (2) The probe cached `serverOk = false`
forever after any hiccup (a restart blip, a timed-out build), so every later
message silently ran the local fallback without trying the server —
indistinguishable from a broken agent. Fix: client `AGENT_TIMEOUT_MS`
matches the server's 150 s; the sticky flag is gone (each message tries the
server; the per-message probe recovers), and a server-unreachable fallback now
says so in the thread instead of masquerading as the agent's answer.

## 2026-10-09 — propose_edit documents exact op shapes; agent budget 30 s → 150 s

Live recreation-center build died twice on avoidable causes. (1) The model
burned four `propose_edit` rounds guessing op shapes (`room.add` with a
top-level `id`, missing nested `rect`) because the tool schema said only
`ops: array of object`. The description now carries literal templates for all
12 ops plus the add-nests / update-takes-id rule, so the shapes are right
first time. (2) The run then died as "(unreachable)": the 30 s server abort
fired mid-retry on a multi-round build. `AGENT_TIMEOUT_MS = 150_000`
(modelShared, re-exported via agentRoute, used by index.ts) covers a 16-round
build; the client keeps its own cancel. `modelFailureHint` now also names
aborts (`request aborted (>150s budget…)`) and network failures (`network:
fetch failed`) instead of "unreachable". 5 new tests (hint variants, budget
floor, shape documentation). If the next build still stalls, the message will
say exactly which of the three it is.

## 2026-10-09 — Model failures name their HTTP status (was a silent catch)

`handleAgent` swallowed every provider failure into a bare "model call
failed", which cost a full debug session: a pasted DeepSeek key was actually
a 401 (truncated copy, 34 chars vs the expected 35) and nothing said so.
`modelFailureHint` (modelShared) now extracts the status + provider error
message from the `model <status>: <body>` throw, logs it server-side, and
prefixes the client fallback text (`The model call failed (HTTP 401:
Authentication Fails, …); …`). Key-safe: only status + provider message
(keys are masked by providers), never bodies/headers — covered by a 401 test
asserting the hint, the fallback, and no key leak.

## 2026-10-09 — Server reads apps/server/.env so restarts keep provider config

Killing and restarting the server dropped `DEEPSEEK_API_KEY`/`PLUMB_PROVIDER`
(they lived only in the user's terminal env), silently demoting the agent to
fallback. Fix: zero-dep `src/env.ts` loaded first in `index.ts` parses
`apps/server/.env` (see `.env.example`); real env vars always take
precedence. The file is gitignored (key never committed). Node module types
are hand-declared in `node-shims.d.ts` per the no-@types/node convention
(`node:fs/url/path/os` + `ImportMeta.url`). 3 new tests cover parsing,
precedence, and missing-file no-op.

## 2026-10-09 — Model loop: 8192-token budget, tolerant propose_edit, self-correctable errors

Live DeepSeek run of the recreation-center build failed: `max_tokens: 1024`
truncated the big `propose_edit` batch mid-JSON, and the model's recovery
attempts (ops as a JSON string, as single objects, split batches) all died
inside opaque errors ("propose_edit: invalid input", "op -1: expected object,
received …") that named no path, so it burned six rounds and gave up honestly.
Fixes: `MAX_OUTPUT_TOKENS = 8192` (fits a whole-plan batch; within
deepseek-chat and Claude 3.5+ caps) for both providers; `MAX_ROUNDS` 8 → 16
for split-batch builds; `normalizeOps` in `executeTool` accepts the shapes
models actually emit under escaping pressure (JSON string of the array, array
of JSON-encoded op strings, single op object, `{ops:[…]}` wrapper); and every
schema rejection now names the offending path (`ops.0.room.rect.w: …`,
"ops must be an array of op objects, a single op object, or a JSON string
encoding either") so one round self-corrects. `applyOps` shape errors include
the Zod path (`at ops.N.…`). 3 new agent tests (normalization variants,
actionable errors) + 1 DeepSeek loop test (from-empty build with ops-as-
JSON-string, 8192 budget, proposal surfaced).

## 2026-10-09 — room.add/room.remove ops close the from-scratch gap (SPEC §5 deviation)

SPEC §5 defines only `room.update`, so an empty plan is a dead end for the
agent: no rooms exist to update and walls alone never yield rooms
(`detectRooms` is not wired into the apply path). The agent correctly refused
to fake a recreation-center layout. Fix: `room.add`/`room.remove` join the op
union with the same validation as `room.update` (non-empty name, finite x/y,
w/h ≥ 100 mm), atomic batch semantics and inverses (`add`↔`remove`) so
undo/redo and the property test hold. `summarizeOp`, the DXF exact-import path
(previously skipped rooms for lack of an add op) and the diff preview (new
`roomsAdded`/`wallsAdded`/`openingsAdded` ghosts + `+ Name` labels) cover the
new ops. System prompt + `propose_edit` description now state empty plans are
buildable via `room.add` + enclosing `wall.add` + `opening.add` + `item.add`.
Agent chat now renders a minimal safe markdown subset (bold/italic/code,
h4, bullet/numbered lists, fenced blocks) instead of raw `**`.

## 2026-10-09 — DeepSeek is a second provider behind PLUMB_PROVIDER, sharing the tool plumbing

`PLUMB_PROVIDER=deepseek` + `DEEPSEEK_API_KEY` selects an OpenAI-compatible
`/chat/completions` loop (`deepseek.ts`); default stays `anthropic`.
`PLUMB_MODEL` is shared, defaulting to `deepseek-chat` under DeepSeek (the
reasoners don't do function calling). Tool defs, system prompt, tool
execution and side-channel emits moved to `modelShared.ts` so the providers
can't drift; `anthropic.ts` is now a thin wrapper with identical behaviour.
`DEEPSEEK_BASE_URL` overrides the endpoint for proxies. `/api/health`
reports `{provider, model, keyConfigured}`. 6 new tests drive the loop with
mocked fetch (tool round-trip, proposal surfacing, bad-args JSON, failure
fallback with no key leak, missing-key hint, unknown provider).

## 2026-10-20 — Nebius Token Factory is the model backend (Nemotron-3.5-Lightning default)

`PLUMB_PROVIDER=nebius` + `NEBIUS_API_KEY` (legacy `NEBIUS_KEY` alias kept for
local `.env` files) selects an OpenAI-compatible `/chat/completions` loop at
`https://api.tokenfactory.nebius.com/v1` (`nebius.ts`). The DeepSeek loop was
extracted verbatim into `openaiCompat.ts` so both providers share one loop and
can't drift; `deepseek.ts` is now a thin wrapper with identical behaviour.
Live experiment, same prompts + tool defs on both catalog models: Lightning
(text2text) and Super-VL (image2text, 120B MoE) both emitted valid `ops`
arrays with exact nested op shapes and never over-triggered tools — but
Lightning answered in ~1–2 s with ~130–460 completion tokens vs ~2–5 s and
3–7x tokens for Super-VL (1000+ hidden reasoning tokens per call). So the
default `PLUMB_MODEL` is `nvidia/Nemotron-3_5-Lightning`; set it to
`nvidia/Nemotron-3.5-Super-VL` when the backend starts sending plan images.
6 new mocked-fetch tests (loop + auth URL, proposal, 401 hint, fallback with
no key leak, missing-key hint) plus a live `handleAgent` smoke test through
`run_checks` verified the wiring.

## 2026-10-09 — Item drags never started: the live pointer map ate the anchor

`onPointerMove` updated `drag.current.pointers` with the current position
*before* the 3 px threshold check read `pointers[0]` as the start — so the
distance was always 0 and `moved` never tripped (selection worked, pans
worked via their separate `panStart`). Fix: `DragState.start` snapshots the
pointerdown screen point; the threshold reads that. E2E flow 2 (real
mouse.down/move/up) caught it; unit tests can't, since they don't run the
React handlers.

## 2026-10-09 — E2E `.agent` selector must be `aside.agent`

`.msg.agent` chat bubbles share the `agent` class, so `locator('.agent')`
goes strict-ambiguous once the thread has messages. Panel assertions scope
to `aside.agent`.

## 2026-10-09 — `toWorld` divided by `view.y` instead of `view.s`

E2E flow 2 caught it: every pointer-derived world y was garbage
(`sy / view.y + view.y`), so walls/doors landed off-plan while their counts
still passed. One-line fix in `CanvasView.tsx`; Library/BottomBar/pinch math
already used `view.s` and were swept for siblings. Lesson: assert geometry,
not just counts, in interaction tests.

## 2026-10-09 — Server runs on tsx with a node-shims declaration

`@plumb/server` (Hono + `@hono/node-server`) executes workspace TS sources,
so it runs under `tsx` instead of a build step. `@types/node` was skipped
(DOM lib already types fetch/Response/AbortController; a 6-line
`node-shims.d.ts` covers `process`/`Buffer`) to keep the toolchain lean on
Node 18. Per-session rate limiting is approximated per IP (20 req/min).

## 2026-10-09 — Convert service is stdlib HTTP, not FastAPI

SPEC §2 names FastAPI, but the service has four endpoints and one dependency
(`ezdxf`), so `services/convert/server.py` uses stdlib `http.server` with the
same route shape (`POST /dxf`, `/ifc`, `/dxf/parse`, `GET /health`). A FastAPI
app can wrap the `plumb_*` modules later without touching the web/server
contract. `/api/convert/*` on the Node server proxies through; DWG slots in
front of `/dxf/parse` as a separate process per §11.

## 2026-10-09 — DXF walls as split segments, not a Clipper union

No Clipper/pyclipper dependency in the service. Each wall is written as the
centreline intervals between opening cuts (the same split the renderer
draws), each a closed `LWPOLYLINE` + solid `HATCH` on `A-WALL`. Identical
output for orthogonal plans; diagonal junctions stay square-capped per §15.
Layout is `A3_1-50` (DXF names reject `/` and spaces); the viewport frames the
plan geometrically (ezdxf exposes no `custom_scale` on VIEWPORT).

## 2026-10-09 — IFC is hand-written STEP, not ifcopenshell

`ifcopenshell` (multi-hundred-MB native wheel) does not fit this environment,
so `plumb_ifc.py` emits IFC4 directly (909 entities on the fixture: project
chain, 8 walls, 11 voids + fills, 5 spaces with Qto + `Pset_Plumb`, 24
furniture boxes). Golden tests assert sequential numbering, resolved `#`
refs, balanced parens and the §11 mapping counts; `ifcopenshell.validate`
plus a viewer pass remain manual checklist items.

## 2026-10-09 — Room detection is a grid flood fill; open plan keeps authored rects

`detectFaces` (100 mm cells, wall face = distance < thickness/2) finds the
bounded faces of the wall graph — 4 on the fixture, since living + kitchen
share one open face below the w8 stub. `detectRooms` carries names/finishes
by max overlap; faces shared by several authored rooms keep the authored
rects so nothing the user named is lost. Closed rooms match within one cell;
total area within 5%.

## 2026-10-09 — Import proposals carry source via the title, plus a grey underlay

`Proposal` has no `source` field and changing the schema for one caller is
not worth it: titles starting with `Import ` apply with history source
`'import'`. Unrecognised geometry rides along as `ui.underlay` (render draws
it grey under the plan, never exported), cleared on apply/dismiss/replace.

## 2026-10-09 — Playwright drives system Chromium; dev-only `__plumb` seam

No disk for Playwright browser downloads, so the config uses
`/usr/bin/chromium-browser` via `launchOptions.executablePath`. Specs assert
through `window.__plumb.getState()` (DEV only) plus real mouse/keyboard
gestures. Narrow-screen check hides the breadcrumb ≤ 860 px (it cost 26 px
of overflow at 390 px).

## 2026-10-09 — Open manual checks (no CAD/viewer in this environment)

Done structurally, still needing a human pass: open the exported DXF in
LibreCAD/AutoCAD (units, layers, hatch, `PLUMB-50` dimensions, block
inserts), open the IFC in BlenderBIM/xeokit (or run
`ifcopenshell.validate`), and run the §11 third-party-plan import for the
heuristics path. The Plumb-authored round trip is fully automated.

## 2026-10-09 — Shell/write outage was a full disk; diagnose via exit codes
`echo hi > file` landed empty with exit 1 while `touch` succeeded: ENOSPC
(100G root at 100%, 62M free). Shell commands still executed, only output
capture and content writes failed. Cleared the npm/pip caches (≈1.3G back)
and everything recovered. Lesson: when tool output goes empty session-wide,
check `df` first; exit-code bitmasks (`exit $code`) still signal through.

## 2026-10-09 — M2 label cache is a key string, dirty flag deferred

The renderer memoises room-label layout on a key of item poses and room
names/floors (same as the prototype). The store-owned dirty flag from SPEC §7
arrives with the Zustand store in M3; `layoutRoomLabels` already isolates the
cache so the swap is local.

## 2026-10-09 — `wallFrame`/`wallPoint` take `Pick<Wall, 'a' | 'b'>`

Hit-testing and corridor math only need endpoints. Loosening the signature
lets render work with partial walls without weakening core checks.

## 2026-10-09 — `fmt` gains a decimals parameter; `fmtNum` added

The scale bar needs 1 decimal under 1000 mm (`1 m`) and 0 above (`2 m`),
matching the prototype. Default stays 2 decimals, so existing callers and
tests are unchanged.

## 2026-10-09 — M2 parity checked with headless Chromium screenshots

`packages/render/dev` (vite, port 5199) renders the fixture through the real
`createRenderer`; screenshots of it and of `plumb-prototype.html` at
1600×1000 were compared side by side (light + dark). Headless Chromium needs
`--use-angle=swiftshader` here (`--disable-gpu` leaves the canvas blank).
One deviation found and fixed: the `1:N` readout is M3 bottom-bar chrome, not
a canvas label, so it was removed from `draw()`.

## 2026-10-09 — M1 scope: core + fixture, no app shell yet

The workspace was empty and M0 (app shell) was skipped by request; M1 needs a
runnable package, so the repo scaffold here is the minimum that lets
`@plumb/core` typecheck, lint and test (pnpm workspaces, base tsconfig,
ESLint flat config, no apps yet). M0's visual shell stays open work.

## 2026-10-09 — Pin TypeScript 5.9.3, Vitest 3.2.7, nanoid 5

The machine runs Node 18. Current stable TypeScript (7.x), Vitest (5.x, needs
Node ≥22) and nanoid (6.x) do not all run there, so M1 pins the newest
Node-18-compatible majors: typescript@5.9.3, vitest@3.2.7, nanoid@5.1.16.
Zod@4.6.5, fast-check@4.10.2, eslint@9.39.5, prettier@3.9.9 are current stable
and run on Node 18. Revisit when the toolchain moves to Node 20+.

## 2026-10-09 — `runChecks` defaults to the error checks

SPEC §13's M1 test expects exactly one issue on the fixture (the Desk in the
d3 swing). The new warns (`passage`, `window-blocked`) are opt-in via
`runChecks(level, { checks })`: `DEFAULT_CHECKS` is
door-swing/overlap/outside-room, `ALL_CHECKS` adds the warns. The agent tool
can still request all checks explicitly. This keeps the fixture assertion
meaningful while the warns mature.

## 2026-10-09 — Passage v1 = doorway approach clearance

"Clear width in a walking route" needs route analysis (a later milestone), so
v1 checks something small and exact: for each door, the rectangle of the
opening width extending `minPassage` (default 900 mm) into the swing-side room
must be clear of furniture. On the fixture this flags exactly the misplaced
desk and nothing after the fix.

## 2026-10-09 — Analytic door-swing test

Replaced the prototype's sampling (100 mm × 10°) with an exact OBB vs
quarter-disc test: disc-vs-box broad phase, then hinge-in-box, centre-in-sector,
corner-in-sector, radial-edge-vs-box and box-edge-vs-arc. Boundary contact
counts, matching the prototype. Verified to give the identical fixture result
(one conflict: Desk vs d3) including the (+200, 0) nudge clearing it.

## 2026-10-09 — Opening margin rule enforced in ops

`applyOps` rejects an opening whose span is not clear of the wall ends by at
least one wall thickness (SPEC §4 convention). The canvas keeps the same clamp
when placing (M3).

## 2026-10-09 — Undo of removes appends re-added entities at the end

`wall.remove` cascades to its openings; the inverse is `wall.add` + one
`opening.add` per cut opening, and adds a