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

1. An environment with Continia Banking and demo data, e.g. one of yours with `banking-demo`
   installed. Get credentials with `continia env users <envId> --json`.
2. `cp .env.example .env` and fill in `BC_URL`, `BC_USER`, `BC_PASS`.
3. `npm run setup` (installs Playwright 1.55.1, the version bc-replay pins, and Chromium).
4. **Record the flow in BC** (needed for A and B): open Bank Account Communication Setup
   (page 71553605), Settings ⚙ → *Page Scripting* → *Start new recording*, then perform:
   select row 1 → **All Direct** → pick *Rabobank ISO20022* → OK → disable *Enabled* on rows 2
   and 3 → **Set Default Communication** → *Rabobank ISO20022* → OK → *Direct* → OK. Stop, then
   *Save* as `recordings/real-bank-acc-com-setup.yml`. This also shows the exact YAML shape BC
   uses, which is what the generate stage would have to emit.

## Run

```bash
npm run whole    -- --recording recordings/real-bank-acc-com-setup.yml
npm run per-step -- --recording recordings/real-bank-acc-com-setup.yml --headed
npm run per-step -- --recording recordings/v1-bank-acc-com-setup.yml --continue
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
