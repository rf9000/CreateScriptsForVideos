import { describe, test, expect, mock } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { makeVideo } from '../../src/video/make-video.ts';
import type { MakeVideoDeps } from '../../src/video/make-video.ts';
import { testConfig } from '../helpers/config.ts';

function itemDir(recording: string, narration?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'item-'));
  writeFileSync(join(dir, 'recording.yml'), recording);
  if (narration) writeFileSync(join(dir, 'narration.yml'), narration);
  return dir;
}

const goodRecording = `description: d
steps:
  - type: page-shown
    source: { page: P }
    runtimeId: a
  - type: validate
    target: [{ page: P, runtimeRef: a }, { field: F }]
    operation: "="
    value: "1"
`;

function deps(overrides: Partial<MakeVideoDeps> = {}): MakeVideoDeps {
  return {
    generateClips: mock(async () => [{ stepIndex: 0, audioPath: 'a.mp3', durationMs: 3000, text: 'Hi' }]),
    recordDemo: mock(async () => ({ ok: true, videoPath: '/v/x.webm', timing: { trimStartMs: 0, steps: [] }, steps: [] })),
    writeSubtitles: mock(() => '/v/demo.ass'),
    composeVideo: mock(() => ({ ok: true, videoPath: '/v/demo.mp4' })),
    ...overrides,
  };
}

const input = (dir: string, apiKey = 'sk') => ({
  itemDir: dir, url: 'https://bc/', user: 'u', password: 'p', config: testConfig({ openaiApiKey: apiKey }),
});

describe('makeVideo', () => {
  test('narrates, records with clip-length holds, composes', async () => {
    const d = deps();
    const r = await makeVideo(input(itemDir(goodRecording, 'steps:\n  0: Hi\n')), d);
    expect(r).toMatchObject({ ok: true, videoPath: '/v/demo.mp4' });
    const recArgs = (d.recordDemo as ReturnType<typeof mock>).mock.calls[0]![0] as { holds: Map<number, number> };
    expect(recArgs.holds.get(0)).toBe(3000);
  });

  test('a lint failure stops before any browser or TTS work', async () => {
    const d = deps();
    const r = await makeVideo(input(itemDir('description: d\nsteps:\n  - type: action\n    caption: X\n')), d);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('unknown step type "action"');
    expect(d.recordDemo).not.toHaveBeenCalled();
    expect(d.generateClips).not.toHaveBeenCalled();
  });

  test('missing OpenAI key: skipped with a reason', async () => {
    const d = deps({ generateClips: mock(async () => { throw new Error('OPENAI_API_KEY is not set; narration needs it'); }) });
    const r = await makeVideo(input(itemDir(goodRecording, 'steps:\n  0: Hi\n'), ''), d);
    expect(r).toMatchObject({ ok: false });
    expect(r.error).toContain('OPENAI_API_KEY');
    expect(d.recordDemo).not.toHaveBeenCalled();
  });

  test('a failed recording step is reported and nothing is composed', async () => {
    const d = deps({
      recordDemo: mock(async () => ({ ok: false, failedStep: 4, error: "Field 'IBAN' was not found.", videoPath: '/v/x.webm', timing: { trimStartMs: 0, steps: [] }, steps: [] })),
    });
    const r = await makeVideo(input(itemDir(goodRecording)), d);
    expect(r).toMatchObject({ ok: false, failedStep: 4 });
    expect(r.error).toContain("step 4: Field 'IBAN' was not found.");
    expect(d.composeVideo).not.toHaveBeenCalled();
  });

  test('no narration file: records with default holds, no subtitles', async () => {
    const d = deps({ generateClips: mock(async () => []) });
    const r = await makeVideo(input(itemDir(goodRecording)), d);
    expect(r.ok).toBe(true);
    expect(d.writeSubtitles).not.toHaveBeenCalled();
  });
});
