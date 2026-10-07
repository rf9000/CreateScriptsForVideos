import { describe, test, expect, mock } from 'bun:test';
import { mkdtempSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { expandAbbreviations, generateClips, parseDuration, voiceForLocale } from '../../src/video/narration.ts';

describe('voiceForLocale', () => {
  test('known locales and default', () => {
    expect(voiceForLocale('da-DK')).toEqual({ voice: 'nova', speed: 0.95 });
    expect(voiceForLocale('xx-XX')).toEqual({ voice: 'nova', speed: 1.0 });
  });
});

describe('parseDuration', () => {
  test('reads the Duration line from ffmpeg -i output', () => {
    expect(parseDuration('  Duration: 00:00:04.52, start: 0.000000')).toBe(4520);
  });
  test('throws when ffmpeg printed no Duration (same as V1)', () => {
    expect(() => parseDuration('nothing')).toThrow('Could not parse audio duration');
  });
});

describe('expandAbbreviations', () => {
  test('expands BC abbreviations for speech', () => {
    expect(expandAbbreviations('Bank Acc. No.')).toBe('Bank Account Number');
  });
});

describe('generateClips', () => {
  test('one clip per narrated step, in step order, with probed durations', async () => {
    const out = mkdtempSync(join(tmpdir(), 'narr-'));
    const tts = mock(async () => new Uint8Array([1, 2, 3]));
    const probe = mock(async () => 2500);
    const clips = await generateClips({ 3: 'Third.', 0: 'First.' }, out, { apiKey: 'k', locale: 'en-US', tts, probe });
    expect(clips.map((c) => c.stepIndex)).toEqual([0, 3]);
    expect(clips[0]!.durationMs).toBe(2500);
    expect(existsSync(clips[1]!.audioPath)).toBe(true);
    expect(tts).toHaveBeenCalledTimes(2);
  });

  test('throws without an API key', async () => {
    await expect(generateClips({ 0: 'x' }, tmpdir(), { apiKey: '', locale: 'en-US' })).rejects.toThrow('OPENAI_API_KEY');
  });
});
