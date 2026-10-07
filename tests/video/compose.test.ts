import { describe, test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { COMPOSE_TIMEOUT_MS, ENCODER_ARGS, SUBTITLE_BAND_PX, formatAssTime, videoFilters, writeSubtitles } from '../../src/video/compose.ts';

describe('formatAssTime', () => {
  test('H:MM:SS.cc', () => {
    expect(formatAssTime(3_723_450)).toBe('1:02:03.45');
  });
});

describe('writeSubtitles', () => {
  test('places each clip at its step start minus the trim, at 1920x1080', () => {
    const dir = mkdtempSync(join(tmpdir(), 'subs-'));
    const ass = writeSubtitles(
      [{ stepIndex: 1, audioPath: 'x.mp3', durationMs: 2000, text: 'Enter the IBAN.' }],
      { trimStartMs: 1000, steps: [{ stepIndex: 1, startMs: 5000, endMs: 9000 }] },
      join(dir, 'demo.ass'),
    );
    const text = readFileSync(ass, 'utf-8');
    expect(text).toContain('PlayResX: 1920');
    expect(text).toContain(`PlayResY: ${1080 + SUBTITLE_BAND_PX}`);
    expect(text).toContain('Dialogue: 0,0:00:04.00,0:00:06.00');
    expect(existsSync(join(dir, 'demo.srt'))).toBe(true);
  });
});

describe('encoding budget', () => {
  test('allows 10 minutes and uses a fast x264 preset (VM encodes are slower than real time)', () => {
    expect(COMPOSE_TIMEOUT_MS).toBe(600_000);
    expect(ENCODER_ARGS).toContain('-preset veryfast');
    expect(ENCODER_ARGS).toContain('-c:v libx264');
  });
});

describe('videoFilters', () => {
  test('trims, adds a black band below the picture, and burns subtitles into the band', () => {
    const f = videoFilters(6500, '/tmp/demo.ass');
    expect(f[0]).toBe('trim=start=6.500,setpts=PTS-STARTPTS');
    expect(f[1]).toBe(`pad=iw:ih+${SUBTITLE_BAND_PX}:0:0:black`);
    expect(f[2]).toContain("ass='");
  });

  test('no subtitles: no band either', () => {
    expect(videoFilters(0, undefined)).toEqual([]);
  });
});
