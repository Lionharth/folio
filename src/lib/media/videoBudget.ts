import {
  MAX_VIDEO_BYTES,
  MAX_VIDEO_LONG_SIDE,
  MAX_VIDEO_SHORT_SIDE,
  MAX_VIDEO_VIDEO_BITRATE,
  MIN_VIDEO_VIDEO_BITRATE,
  VIDEO_AUDIO_BITRATE,
  VIDEO_TARGET_BYTES,
} from '../../constants/media';

export interface VideoBudgetInput {
  width?: number | null;
  height?: number | null;
  durationMs: number;
  sizeBytes?: number | null;
}

export type CompressionReason = 'resolution' | 'size' | 'both' | 'unknown' | null;

export interface VideoCompressionPlan {
  needsCompression: boolean;
  /** Long-side bound passed to the native compressor. */
  maxSize: number;
  /** Video-only bitrate in bits per second. */
  bitrate: number;
  reason: CompressionReason;
  /** False when the clip cannot fit in the size budget without dropping audio. */
  feasible: boolean;
}

function positive(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Returns the long-side bound that caps the shorter side at 1080 px while never
 * upscaling and never exceeding 1920 px on the long side.
 */
export function targetLongSide(width?: number | null, height?: number | null): number {
  const w = positive(width);
  const h = positive(height);
  if (!w || !h) return MAX_VIDEO_LONG_SIDE;
  const shortSide = Math.min(w, h);
  const longSide = Math.max(w, h);
  if (shortSide <= MAX_VIDEO_SHORT_SIDE) return Math.round(longSide);
  const scaled = Math.round((MAX_VIDEO_SHORT_SIDE * longSide) / shortSide);
  return Math.max(2, Math.min(MAX_VIDEO_LONG_SIDE, scaled));
}

export function planVideoCompression(input: VideoBudgetInput): VideoCompressionPlan {
  const width = positive(input.width);
  const height = positive(input.height);
  const sizeBytes = positive(input.sizeBytes);
  const durationSeconds = Math.max(0, input.durationMs) / 1000;
  const dimensionsKnown = Boolean(width && height);

  const resolutionTooHigh = dimensionsKnown && Math.min(width!, height!) > MAX_VIDEO_SHORT_SIDE;
  const sizeTooBig = Boolean(sizeBytes && sizeBytes > VIDEO_TARGET_BYTES);
  const unknownDimensions = !dimensionsKnown;

  const reason: CompressionReason =
    resolutionTooHigh && sizeTooBig
      ? 'both'
      : resolutionTooHigh
        ? 'resolution'
        : sizeTooBig
          ? 'size'
          : unknownDimensions
            ? 'unknown'
            : null;

  // A 10% container/muxer cushion keeps the output below the byte ceiling.
  const budgetTotal = durationSeconds > 0 ? (VIDEO_TARGET_BYTES * 8 * 0.9) / durationSeconds : Infinity;
  const sourceTotal = durationSeconds > 0 && sizeBytes ? (sizeBytes * 8) / durationSeconds : Infinity;
  // Never ask for more video bitrate than the source already uses (that would
  // grow the file), and never exceed the remaining budget after audio.
  const desired = Math.min(
    budgetTotal - VIDEO_AUDIO_BITRATE,
    Number.isFinite(sourceTotal) ? sourceTotal * 0.95 - VIDEO_AUDIO_BITRATE : Infinity
  );
  const bitrate = Math.round(Math.max(MIN_VIDEO_VIDEO_BITRATE, Math.min(desired, MAX_VIDEO_VIDEO_BITRATE)));

  const feasible = budgetTotal === Infinity || budgetTotal - VIDEO_AUDIO_BITRATE >= MIN_VIDEO_VIDEO_BITRATE;

  return {
    needsCompression: resolutionTooHigh || sizeTooBig || unknownDimensions,
    maxSize: targetLongSide(width, height),
    bitrate,
    reason,
    feasible,
  };
}

export function exceedsVideoCap(sizeBytes: number): boolean {
  return sizeBytes > MAX_VIDEO_BYTES;
}
