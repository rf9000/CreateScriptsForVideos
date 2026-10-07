import { describe, test, expect } from 'bun:test';
import { pauseAfterStep, sliceFor, stageSafely, waitAtEnd, waitBeforeStep } from '../../src/video/recorder.ts';
import { errorText, startUrl } from '../../src/video/bc-session.ts';
import type { Recording } from '../../src/video/recording.ts';

const rec: Recording = {
  name: 'n',
  description: 'd',
  start: { profile: 'BUSINESS MANAGER' },
  steps: [{ type: 'navigate' }, { type: 'page-shown', runtimeId: 'a' }],
};

describe('sliceFor', () => {
  test('only the first slice carries start (later slices must not navigate back)', () => {
    expect(sliceFor(rec, 0).start).toEqual({ profile: 'BUSINESS MANAGER' });
    expect(sliceFor(rec, 1).start).toBeUndefined();
    expect(sliceFor(rec, 1).steps).toEqual([{ type: 'page-shown', runtimeId: 'a' }]);
  });
});

describe('narration pacing', () => {
  test('a narrated step waits only until the previous narration has finished (plus a breath)', () => {
    expect(waitBeforeStep(true, 10_000, 12_000)).toBe(2_400);
    expect(waitBeforeStep(true, 15_000, 12_000)).toBe(0);
  });

  test('unnarrated steps never wait: they play under the running voice', () => {
    expect(waitBeforeStep(false, 10_000, 12_000)).toBe(0);
  });

  test('after a step only a short pause for the eye; invisible steps none', () => {
    expect(pauseAfterStep('input')).toBe(700);
    expect(pauseAfterStep('invoke')).toBe(700);
    expect(pauseAfterStep('page-shown')).toBe(0);
    expect(pauseAfterStep('validate')).toBe(0);
  });

  test('the video ends after the last narration plus a short tail', () => {
    expect(waitAtEnd(20_000, 23_000)).toBe(4_500);
    expect(waitAtEnd(30_000, 23_000)).toBe(1_500);
  });
});

describe('errorText', () => {
  test('normalizes BC error shapes', () => {
    expect(errorText(undefined)).toBeUndefined();
    expect(errorText('boom')).toBe('boom');
    expect(errorText({ message: "Field 'X' was not found." })).toBe("Field 'X' was not found.");
  });
});

describe('stageSafely', () => {
  test('a staging error is noted and swallowed: staging is cosmetic', async () => {
    const notes: string[] = [];
    const result = await stageSafely(async () => {
      throw new Error('locator.click: Timeout 30000ms exceeded');
    }, notes);
    expect(result).toBeUndefined();
    expect(notes).toEqual(['staging failed: locator.click: Timeout 30000ms exceeded']);
  });

  test('passes the result through when staging works', async () => {
    const notes: string[] = [];
    expect(await stageSafely(async () => 42, notes)).toBe(42);
    expect(notes).toEqual([]);
  });
});

describe('startUrl', () => {
  test('adds profile and the start page as a deep link (BC does not navigate to start.page itself)', () => {
    expect(startUrl('https://bc/env-1', 'BUSINESS MANAGER', 371)).toBe('https://bc/env-1?profile=BUSINESS%20MANAGER&page=371');
  });
  test('no page id: Role Center', () => {
    expect(startUrl('https://bc/env-1/', 'BUSINESS MANAGER')).toBe('https://bc/env-1/?profile=BUSINESS%20MANAGER');
  });
});
