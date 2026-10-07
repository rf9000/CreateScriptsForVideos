import { describe, test, expect } from 'bun:test';
import { holdFor, sliceFor, stageSafely } from '../../src/video/recorder.ts';
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

describe('holdFor', () => {
  test('narrated steps hold for clip + 500 ms, at least 1500 ms; others use the default', () => {
    const clips = new Map([[0, 4000], [1, 200]]);
    expect(holdFor(0, clips, 1200)).toBe(4500);
    expect(holdFor(1, clips, 1200)).toBe(1500);
    expect(holdFor(2, clips, 1200)).toBe(1200);
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
