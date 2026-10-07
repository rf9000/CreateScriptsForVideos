import { execSync } from 'child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { ffmpegPath } from './narration.ts';
import type { Clip } from './narration.ts';

/**
 * Subtitles (ASS with fades, plus SRT) and the final FFmpeg composition:
 * trim the loading screen, lay narration clips on the step timeline, burn
 * subtitles. Ported from V1 subtitle-gen.ts and composer.ts.
 */

export type Timing = { trimStartMs: number; steps: Array<{ stepIndex: number; startMs: number; endMs: number }> };

export type ComposeResult = { ok: boolean; videoPath?: string; error?: string };

/** A small Linux VM encodes 1080p below real time; give long demos room. */
export const COMPOSE_TIMEOUT_MS = 600_000;
/** veryfast keeps encode time down at a small size cost; screen recordings compress well. */
export const ENCODER_ARGS = ['-c:v libx264', '-preset veryfast', '-c:a aac', '-b:a 192k'];

/** Black band below the 1080p picture that holds the subtitles, so they never cover the UI. */
export const SUBTITLE_BAND_PX = 140;

/** FFmpeg -vf chain: trim the loading screen, then (with subtitles) add the band and burn them in. */
export function videoFilters(trimMs: number, subtitlePath: string | undefined): string[] {
  const filters: string[] = [];
  // setpts trim instead of -ss: input seeking on webm is unreliable.
  if (trimMs > 0) filters.push(`trim=start=${(trimMs / 1000).toFixed(3)},setpts=PTS-STARTPTS`);
  if (subtitlePath) {
    filters.push(`pad=iw:ih+${SUBTITLE_BAND_PX}:0:0:black`);
    const absSubPath = resolve(subtitlePath).replace(/\\/g, '/').replace(/:/g, '\\:');
    filters.push(`ass='${absSubPath}'`);
  }
  return filters;
}

const FADE_IN_MS = 300;
const FADE_OUT_MS = 400;
const MAX_WORDS_PER_CHUNK = 12;

/**
 * Generates an ASS subtitle file with fade-in/fade-out effects.
 * ASS format gives us smooth transitions that look like real movie subtitles.
 * Also generates a plain SRT sidecar for accessibility.
 */
export function writeSubtitles(
  clips: Clip[],
  timing: Timing,
  outputPath: string,
): string {
  const absPath = resolve(outputPath);
  const srtPath = absPath.replace(/\.ass$/, '.srt').replace(/\.srt$/, '.srt');
  const assPath = absPath.replace(/\.srt$/, '.ass');

  const assLines: string[] = [
    '[Script Info]',
    'Title: Demo Narration',
    'ScriptType: v4.00+',
    'PlayResX: 1920',
    `PlayResY: ${1080 + SUBTITLE_BAND_PX}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Centered in the black band below the picture.
    'Style: Default,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,60,60,45,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const srtLines: string[] = [];
  let srtIndex = 1;

  for (const clip of clips) {
    const stepTiming = timing.steps.find((s) => s.stepIndex === clip.stepIndex);
    if (!stepTiming) continue;

    const startMs = Math.max(0, stepTiming.startMs - timing.trimStartMs);
    const chunks = splitIntoChunks(clip.text, MAX_WORDS_PER_CHUNK);
    const totalWords = clip.text.split(/\s+/).length;

    // Distribute chunks across the clip duration proportional to word count
    let offsetMs = 0;
    for (const chunk of chunks) {
      const chunkWords = chunk.split(/\s+/).length;
      const chunkDurationMs = Math.round((chunkWords / totalWords) * clip.durationMs);
      const chunkStartMs = startMs + offsetMs;
      const chunkEndMs = chunkStartMs + chunkDurationMs;

      // ASS entry with fade effect
      const wrapped = wrapText(chunk.replace(/\n/g, '\\N'), 70).replace(/\n/g, '\\N');
      assLines.push(
        `Dialogue: 0,${formatAssTime(chunkStartMs)},${formatAssTime(chunkEndMs)},Default,,0,0,0,,{\\fad(${FADE_IN_MS},${FADE_OUT_MS})}${wrapped}`,
      );

      // SRT entry (plain, no effects)
      srtLines.push(String(srtIndex));
      srtLines.push(`${formatSrtTime(chunkStartMs)} --> ${formatSrtTime(chunkEndMs)}`);
      srtLines.push(wrapText(chunk, 60));
      srtLines.push('');
      srtIndex++;

      offsetMs += chunkDurationMs;
    }
  }

  writeFileSync(assPath, assLines.join('\n'), 'utf-8');
  writeFileSync(srtPath, srtLines.join('\n'), 'utf-8');
  return assPath;
}

// ASS time format: H:MM:SS.cc (centiseconds)
export function formatAssTime(ms: number): string {
  const hours = Math.floor(ms / 3600_000);
  const minutes = Math.floor((ms % 3600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const centis = Math.floor((ms % 1000) / 10);
  return `${hours}:${pad(minutes)}:${pad(seconds)}.${pad(centis)}`;
}

// SRT time format: HH:MM:SS,mmm
export function formatSrtTime(ms: number): string {
  const hours = Math.floor(ms / 3600_000);
  const minutes = Math.floor((ms % 3600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad3(millis)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function pad3(n: number): string {
  return String(n).padStart(3, '0');
}

/**
 * Splits text into chunks of roughly maxWords words each, breaking at
 * sentence boundaries when possible so subtitles read naturally.
 */
function splitIntoChunks(text: string, maxWords: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return [text.trim()];

  // Split into sentences first, then merge small sentences / split large ones
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  const chunks: string[] = [];
  let current: string[] = [];
  let currentWordCount = 0;

  for (const sentence of sentences) {
    const sentenceWords = sentence.trim().split(/\s+/);

    // If adding this sentence stays within limit, accumulate
    if (currentWordCount + sentenceWords.length <= maxWords) {
      current.push(sentence.trim());
      currentWordCount += sentenceWords.length;
      continue;
    }

    // Flush current accumulator if non-empty
    if (current.length > 0) {
      chunks.push(current.join(' '));
      current = [];
      currentWordCount = 0;
    }

    // If this sentence itself exceeds maxWords, split it by word count
    if (sentenceWords.length > maxWords) {
      for (let i = 0; i < sentenceWords.length; i += maxWords) {
        chunks.push(sentenceWords.slice(i, i + maxWords).join(' '));
      }
    } else {
      current.push(sentence.trim());
      currentWordCount = sentenceWords.length;
    }
  }

  if (current.length > 0) {
    chunks.push(current.join(' '));
  }

  return chunks;
}

export function wrapText(text: string, maxLineLength: number): string {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (currentLine.length + word.length + 1 > maxLineLength && currentLine.length > 0) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = currentLine ? `${currentLine} ${word}` : word;
    }
  }
  if (currentLine) lines.push(currentLine);

  return lines.join('\n');
}

/**
 * Composes video with per-step audio clips, optional subtitles, and login trimming.
 * Builds a time-aligned audio track by concatenating silence gaps + clips,
 * then merges with the video via FFmpeg.
 */
export function composeVideo(options: {
  videoPath: string;
  clips: Clip[];
  timing: Timing;
  subtitlePath?: string;
  outputPath: string;
}): ComposeResult {
  const ffmpeg = ffmpegPath();
  const { videoPath, clips, timing, subtitlePath, outputPath } = options;
  const absVideo = resolve(videoPath);
  const absOutput = resolve(outputPath);

  if (!existsSync(absVideo)) {
    return { ok: false, error: `Video not found: ${absVideo}` };
  }

  mkdirSync(dirname(absOutput), { recursive: true });

  // Create temp directory for intermediate files
  const tmpDir = resolve(dirname(absOutput), `.tmp-compose-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  try {
    // Step 1: Build the concatenated audio track
    const trimMs = timing.trimStartMs;
    const combinedAudioPath = join(tmpDir, 'combined.mp3');

    buildCombinedAudio(ffmpeg, clips, timing, trimMs, tmpDir, combinedAudioPath);

    // Step 2: Compose video + audio + optional subtitles
    // Note: -ss AFTER -i for webm (input seeking on webm is unreliable)
    const cmdParts = [`"${ffmpeg}"`];
    cmdParts.push(`-i "${absVideo}"`);
    cmdParts.push(`-i "${combinedAudioPath}"`);

    const vFilters = videoFilters(trimMs, subtitlePath && existsSync(resolve(subtitlePath)) ? subtitlePath : undefined);
    if (vFilters.length > 0) {
      cmdParts.push(`-vf "${vFilters.join(',')}"`);
    }

    // Note: do NOT trim the audio — buildCombinedAudio already places clips
    // at trim-adjusted positions (stepStartMs - trimMs), so the audio track
    // is already aligned to the trimmed video timeline.

    cmdParts.push(...ENCODER_ARGS);
    cmdParts.push('-map 0:v:0');
    cmdParts.push('-map 1:a:0');
    // Don't use -shortest: let the video play fully even if audio is shorter
    cmdParts.push('-y');
    cmdParts.push(`"${absOutput}"`);

    const cmd = cmdParts.join(' ');

    try {
      execSync(cmd, { stdio: 'pipe', timeout: COMPOSE_TIMEOUT_MS });
    } catch (e: unknown) {
      const stderr = (e as { stderr?: Buffer }).stderr?.toString() ?? '';
      throw new Error(`ffmpeg failed: ${stderr.slice(-500)}`);
    }

    return { ok: true, videoPath: absOutput };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Composition failed: ${message}` };
  } finally {
    // Clean up temp files
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/**
 * Builds a single audio file by concatenating silence gaps and step clips
 * in the correct order, time-aligned to the trimmed video timeline.
 */
function buildCombinedAudio(
  ffmpeg: string,
  clips: Clip[],
  timing: Timing,
  trimMs: number,
  tmpDir: string,
  outputPath: string,
): void {
  const sortedClips = [...clips].sort((a, b) => a.stepIndex - b.stepIndex);
  const concatEntries: string[] = [];
  let currentTimeMs = 0;

  for (const clip of sortedClips) {
    const stepTiming = timing.steps.find((s) => s.stepIndex === clip.stepIndex);
    if (!stepTiming) continue;

    // When this clip should start in the trimmed timeline
    const clipStartMs = Math.max(0, stepTiming.startMs - trimMs);

    // Generate silence to fill the gap before this clip
    const silenceDurationMs = clipStartMs - currentTimeMs;
    if (silenceDurationMs > 50) {
      // Skip trivial gaps
      const silencePath = join(tmpDir, `silence-${clip.stepIndex}.mp3`);
      const silenceSec = (silenceDurationMs / 1000).toFixed(3);
      // Match TTS sample rate (24000 Hz mono) so concat timing stays in sync
      execSync(
        `"${ffmpeg}" -f lavfi -i anullsrc=r=24000:cl=mono -t ${silenceSec} -c:a libmp3lame -q:a 9 "${silencePath}"`,
        { stdio: 'pipe', timeout: 10_000 },
      );
      concatEntries.push(`file '${silencePath.replace(/\\/g, '/')}'`);
    }

    // Add the audio clip
    concatEntries.push(`file '${resolve(clip.audioPath).replace(/\\/g, '/')}'`);
    currentTimeMs = clipStartMs + clip.durationMs;
  }

  if (concatEntries.length === 0) {
    // No clips — generate a short silence as placeholder
    execSync(
      `"${ffmpeg}" -f lavfi -i anullsrc=r=24000:cl=mono -t 1 -c:a libmp3lame -q:a 9 "${outputPath}"`,
      { stdio: 'pipe', timeout: 10_000 },
    );
    return;
  }

  // Write concat list and concatenate
  const concatListPath = join(tmpDir, 'concat-list.txt');
  writeFileSync(concatListPath, concatEntries.join('\n'), 'utf-8');

  execSync(`"${ffmpeg}" -f concat -safe 0 -i "${concatListPath}" -c copy "${outputPath}"`, {
    stdio: 'pipe',
    timeout: 30_000,
  });

}
