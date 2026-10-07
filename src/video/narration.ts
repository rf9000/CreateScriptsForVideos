import OpenAI from 'openai';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import type { Narration } from './recording.ts';

/** Per-step narration with OpenAI TTS. Abbreviation table and parseDuration ported verbatim from V1 narrator.ts. */

export type Clip = { stepIndex: number; audioPath: string; durationMs: number; text: string };
export type TtsFn = (text: string, voice: string, speed: number) => Promise<Uint8Array>;
type Voice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';

const VOICES: Record<string, { voice: Voice; speed: number }> = {
  'da-DK': { voice: 'nova', speed: 0.95 },
  'en-US': { voice: 'nova', speed: 1.0 },
  'en-GB': { voice: 'nova', speed: 1.0 },
  'de-DE': { voice: 'nova', speed: 0.95 },
  'nl-NL': { voice: 'nova', speed: 0.95 },
  'no-NO': { voice: 'nova', speed: 0.95 },
  'sv-SE': { voice: 'nova', speed: 0.95 },
};

export function voiceForLocale(locale: string): { voice: Voice; speed: number } {
  return VOICES[locale] ?? { voice: 'nova', speed: 1.0 };
}

export function ffmpegPath(): string {
  const require = createRequire(import.meta.url);
  return (require('ffmpeg-static') as string | null) ?? 'ffmpeg';
}

// Common BC abbreviations → spoken form for TTS
const BC_ABBREVIATIONS: [RegExp, string][] = [
  [/\bNo\./g, 'Number'],
  [/\bAcc\./g, 'Account'],
  [/\bRecon\./g, 'Reconciliation'],
  [/\bStmt\./g, 'Statement'],
  [/\bAmt\./g, 'Amount'],
  [/\bBal\./g, 'Balance'],
  [/\bQty\./g, 'Quantity'],
  [/\bDesc\./g, 'Description'],
  [/\bDoc\./g, 'Document'],
  [/\bPmt\./g, 'Payment'],
  [/\bJnl\./g, 'Journal'],
  [/\bGen\./g, 'General'],
  [/\bCust\./g, 'Customer'],
  [/\bVend\./g, 'Vendor'],
  [/\bInv\./g, 'Invoice'],
  [/\bDim\./g, 'Dimension'],
  [/\bCurr\./g, 'Currency'],
  [/\bExt\./g, 'External'],
  [/\bId\b/g, 'I.D.'],
];

export function expandAbbreviations(text: string): string {
  let result = text;
  for (const [pattern, replacement] of BC_ABBREVIATIONS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

export function parseDuration(output: string): number {
  const match = output.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
  if (!match) throw new Error('Could not parse audio duration from FFmpeg output');
  const [, hours = '0', minutes = '0', seconds = '0', centiseconds = '0'] = match;
  return (
    parseInt(hours, 10) * 3600_000 +
    parseInt(minutes, 10) * 60_000 +
    parseInt(seconds, 10) * 1000 +
    parseInt(centiseconds.padEnd(3, '0').slice(0, 3), 10)
  );
}


async function probeDuration(path: string): Promise<number> {
  try {
    execFileSync(ffmpegPath(), ['-i', path], { stdio: 'pipe' });
    return 0;
  } catch (e) {
    // ffmpeg -i with no output exits non-zero but prints the header (with Duration) on stderr.
    return parseDuration(String((e as { stderr?: Buffer }).stderr ?? ''));
  }
}

function openAiTts(apiKey: string): TtsFn {
  const client = new OpenAI({ apiKey });
  return async (text, voice, speed) => {
    const res = await client.audio.speech.create({ model: 'tts-1-hd', voice: voice as Voice, input: text, speed, response_format: 'mp3' });
    return new Uint8Array(await res.arrayBuffer());
  };
}

/** TTS one mp3 per narrated recording step, three at a time (V1 step-audio). */
export async function generateClips(
  narration: Narration,
  outDir: string,
  opts: { apiKey: string; locale: string; tts?: TtsFn; probe?: (path: string) => Promise<number> },
): Promise<Clip[]> {
  if (!opts.apiKey && !opts.tts) throw new Error('OPENAI_API_KEY is not set; narration needs it');
  const tts = opts.tts ?? openAiTts(opts.apiKey);
  const probe = opts.probe ?? probeDuration;
  const { voice, speed } = voiceForLocale(opts.locale);
  const dir = join(outDir, 'narration');
  mkdirSync(dir, { recursive: true });
  const entries = Object.entries(narration)
    .map(([k, text]) => ({ stepIndex: Number(k), text }))
    .sort((a, b) => a.stepIndex - b.stepIndex);
  const clips: Clip[] = [];
  for (let i = 0; i < entries.length; i += 3) {
    const batch = await Promise.all(
      entries.slice(i, i + 3).map(async ({ stepIndex, text }) => {
        const audioPath = join(dir, `step-${stepIndex}.mp3`);
        writeFileSync(audioPath, await tts(expandAbbreviations(text), voice, speed));
        return { stepIndex, audioPath, durationMs: await probe(audioPath), text };
      }),
    );
    clips.push(...batch);
  }
  return clips;
}
