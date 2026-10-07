# Spike: BC replay engine as the video recorder

**Question:** can Business Central's own Page Scripting engine (`window.DN.playRecording`, the
engine behind `@microsoft/bc-replay`) drive demo recordings reliably enough to build the video
feature on?

V1 (`C:\GeneralDev\continia-demo-generator`) found elements itself (DOM selectors, then vision
coordinates, then an LLM DOM interpreter) and failed on grids, toggles, FastTabs and lookups. It
used BC's engine only as a last resort because it doesn't show a cursor. This spike inverts that:
**BC's engine executes every step; our code only animates a cosmetic cursor.** A missed cursor
costs a glide, never a step.

Time box: 1–2 days.

## Target design (if the spike passes)

Two work-item tags, one pipeline:

| Tag | Runs |
|---|---|
| `create script` (today) | generate → validate → provision → activate → deploy → verify → attach script + env comment |
| `create video` (new) | the same, plus: generate also emits a Page Scripting YAML → **replay gate** (headless replay after verify, agent repair loop on failure) → TTS per step → record (this harness's per-step mode) → compose (V1's subtitle/FFmpeg code) → attach mp4 |

## Experiments

| | Recording | Mode | Answers |
|---|---|---|---|
| A | real (BC-recorded) | `whole` | Does BC's engine replay our flow reliably? Run 3×. |
| B | real (BC-recorded) | `per-step` | Does the state survive between separate per-step calls? Is pacing and cursor good enough for video? |
| C | `recordings/v1-bank-acc-com-setup.yml` | `whole`, then `per-step` | Can an LLM-authored script (what the generate stage would emit) be replayed, or must we learn the exact format from real recordings? |

## Setup

1. An environment with Continia Banking and demo data, activated with
   `.tools/continia.exe --auth-method api-token deps install-by-id <envId> c3755ece-dab0-4d16-987d-040661f18522 --json`.
2. Nothing else to configure: pass `--env <envId>` and the harness reads the URL and login with
   the continia CLI (`CONTINIA_API_TOKEN` comes from the repo `.env`; the CLI defaults to
   `../../.tools/continia.exe`). To point at a non-DemoPortal client instead, set `BC_URL`,
   `BC_USER`, `BC_PASS` in `spikes/replay-video/.env`.
3. `npm run setup` (installs Playwright 1.55.1, the version bc-replay pins, and Chromium).
4. **Record the flow in BC** (needed for A and B): open Bank Account Communication Setup
   (page 71553605), Settings ⚙ → *Page Scripting* → *Start new recording*, then perform:
   select row 1 → **All Direct** → pick *Rabobank ISO20022* → OK → disable *Enabled* on rows 2
   and 3 → **Set Default Communication** → *Rabobank ISO20022* → OK → *Direct* → OK. Stop, then
   *Save* as `recordings/real-bank-acc-com-setup.yml`. This also shows the exact YAML shape BC
   uses, which is what the generate stage would have to emit.

## Run

```bash
npm run whole    -- --env <envId> --recording recordings/real-bank-acc-com-setup.yml
npm run per-step -- --env <envId> --recording recordings/real-bank-acc-com-setup.yml --headed
npm run per-step -- --env <envId> --recording recordings/v1-bank-acc-com-setup.yml --continue
```

Options: `--headed`, `--hold-ms 1500` (pause after each step, stands in for narration),
`--keep-start` (send `start` with every slice), `--no-cursor`, `--continue` (don't stop at the
first failing step), `--out <dir>`.

Each run writes `results/<recording>-<mode>-<time>/`: the `.webm` video (1920x1080),
`summary.json` (per-step replayed/error/cursor/ms), `shots/` (screenshot after each step), and
for `whole` mode `replay-log.yml` (BC's own per-step log).

Notes:
- The data changes during a run (All Direct and so on). The flow ends with a reset, but if a run
  stops halfway, reset the data before the next run.
- `npx replay` (the official launcher) needs PowerShell 7, which isn't installed here. The harness
  runs the same `playRecording` / `resumePlayback` loop as bc-replay's `Commands.js`.
- Run with Node ≥ 22.18; it runs the `.ts` files directly by stripping types.

## Pass criteria

| Criterion | Pass |
|---|---|
| A: steps replayed | all, in 3 of 3 runs |
| B: per-step equals whole | the same final state as A (compare `shots/`) and no step errors |
| B: no re-navigation | steps after the first don't jump back to the start page (otherwise retry with `--keep-start` to compare) |
| B: cursor found | ≥ 80% of steps; misses are acceptable but should be explainable |
| Video | a human watching `per-step` can follow the demo; no visible failures or retries |
| C | informative only: which LLM-authored step shapes BC accepts or rejects, and why |

## Findings so far (2026-10-07, env `b291025e…`, BASE BC 29.0)

Environment: created from the BASE 29.0 profile, then installed from the DemoPortal catalog with
`deps install-by-id`: Core Internal Activation App, Continia Banking, Banking Import/Export,
**Continia Banking Demo (`efd0481e-a034-4dff-ab15-8ced9df75745`, in the catalog)**.

1. **First login shows a "Welcome to your Continia Demo Environment" wizard** (from Banking Demo)
   over the Role Center. Any recorder, and the V2 pipeline, must close it before the demo starts.
   The harness now closes it off camera.
2. **`start.page` does not navigate.** BC's engine starts wherever the client is. V1's `?page=<id>`
   deep link works (`--page 71553605`); a generated script needs the page ID (or navigation steps).
3. **`target.page` must be the AL object name** (`CTS-CB Bank Acc. Com. Setup`), not the caption
   (`Bank Account Communication Setup`). The engine checks it: `Unexpected page. Was expecting
   'Bank Account Communication Setup' but got page with name 'CTS-CB Bank Acc. Com. Setup'`.
4. **The engine's "replayed" count is not proof.** V1-shaped action steps (`caption` only) and
   `row` on an empty grid "replayed" in 0–2 ms with no error and no visible effect; only the input
   step failed (`Field 'Enabled' was not found`). The video recorder needs its own check after each
   step (expected page and state). A real recording will show whether this is just V1's step shape.
5. **Installing Banking Demo creates no data.** Page 71553605 is empty in CRONUS International Ltd.
   The demo data probably comes from the welcome wizard ("Choose Next for a list of available demo
   and test resources"). For V2 this is the PTE's job; for the spike, run the wizard once.

6. **V1's step format was wrong at the root.** Real BC recordings (shape copied from a published
   example) use `navigate`, `page-shown`, `filter`, `input`, `invoke` (`invokeType: Edit` on a
   `repeater`), `validate`, with `target: [{page, runtimeRef}, {field|action|repeater}]` and
   `runtimeId` on `page-shown`. With that format the engine does real work:
   `recordings/std-customer-card.yml` (standard BC, no demo data) navigated, filtered, opened the
   row and passed both `validate` steps, including a card field changed by `input`.
   Only my guessed action shape (`invoke` + `{action: Statistics}`) did nothing.
7. **Per-step replay keeps state.** `recordings/iban-autofill.yml` in `per-step` mode: navigate →
   list → open row → inputs all worked as separate calls, with no jump back to the start page.
8. **Continia Banking is active after the activation app.** Entering an IBAN triggered Banking's
   lookup, which asked "The bank account information has already been filled in. Do you want to
   update it?". The script had no step for that dialog, so the step waited 44 s and the change was
   rolled back. Dialog and action step shapes are the remaining unknowns; one real recording of the
   IBAN flow (New → IBAN → confirm) answers both.
9. The cursor overlay only found 1 of 8 targets: it looks elements up by caption, but real steps name
   fields and repeaters by control name. It needs the same names BC uses.

Next (superseded): run the welcome wizard to create demo data, record the flow with Page Scripting (setup step 4),
then run A, B and C again.

## Results

Fill in after running:

| Exp | Run | Steps ok | Cursor found | Notes |
|---|---|---|---|---|
| A | 1 | | – | |
| A | 2 | | – | |
| A | 3 | | – | |
| B | 1 | | | |
| C | whole | | – | |
| C | per-step | | | |

**Decision:** go / no-go for the `create video` tag, and which parts of V1 to port
(`narrator.ts`, `step-audio.ts`, `subtitle-gen.ts`, `composer.ts`, `cursor.ts`).
