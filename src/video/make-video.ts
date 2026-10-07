import { join } from 'path';
import type { AppConfig } from '../types/index.ts';
import { lintRecording, loadVideoInputs } from './recording.ts';
import { recordDemo } from './recorder.ts';
import type { RecordResult } from './recorder.ts';
import { generateClips } from './narration.ts';
import { composeVideo, writeSubtitles } from './compose.ts';

export type VideoResult = { ok: boolean; videoPath?: string; error?: string; failedStep?: number; steps?: RecordResult['steps'] };

export type MakeVideoDeps = {
  generateClips: typeof generateClips;
  recordDemo: typeof recordDemo;
  writeSubtitles: typeof writeSubtitles;
  composeVideo: typeof composeVideo;
};

const defaultDeps: MakeVideoDeps = { generateClips, recordDemo, writeSubtitles, composeVideo };

/** Narrate, record and compose the demo for one item folder. Never throws. */
export async function makeVideo(
  input: { itemDir: string; url: string; user: string; password: string; config: AppConfig },
  deps: MakeVideoDeps = defaultDeps,
): Promise<VideoResult> {
  try {
    const { recording, hints, narration } = loadVideoInputs(input.itemDir);
    const problems = lintRecording(recording);
    if (problems.length) return { ok: false, error: `recording.yml is not replayable: ${problems.join('; ')}` };

    // Keep only narration for steps that exist.
    const valid = Object.fromEntries(Object.entries(narration).filter(([k]) => Number(k) < recording.steps.length));
    const clips = await deps.generateClips(valid, input.itemDir, {
      apiKey: input.config.openaiApiKey,
      locale: input.config.videoLocale,
    });
    const holds = new Map(clips.map((c) => [c.stepIndex, c.durationMs]));

    const rec = await deps.recordDemo({
      recording, hints, holds,
      url: input.url, user: input.user, password: input.password,
      outDir: join(input.itemDir, 'video'),
      headed: input.config.videoHeaded,
    });
    if (!rec.ok || !rec.videoPath) {
      const where = rec.failedStep !== undefined ? `step ${rec.failedStep}: ` : '';
      return { ok: false, failedStep: rec.failedStep, error: `recording failed at ${where}${rec.error ?? 'no video'}`, steps: rec.steps };
    }

    const subtitlePath = clips.length ? deps.writeSubtitles(clips, rec.timing, join(input.itemDir, 'video', 'demo.ass')) : undefined;
    const composed = deps.composeVideo({
      videoPath: rec.videoPath, clips, timing: rec.timing, subtitlePath,
      outputPath: join(input.itemDir, 'demo.mp4'),
    });
    if (!composed.ok) return { ok: false, error: composed.error, steps: rec.steps };
    return { ok: true, videoPath: composed.videoPath, steps: rec.steps };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
