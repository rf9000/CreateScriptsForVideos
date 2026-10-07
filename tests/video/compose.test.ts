import { describe, test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { formatAssTime, writeSubtitles } from '../../src/video/compose.ts';

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
    expect(text).toContain('Dialogue: 0,0:00:04.00,0:00:06.00');
    expect(existsSync(join(dir, 'demo.srt'))).toBe(true);
  });
});
