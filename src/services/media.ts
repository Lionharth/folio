import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { NativeModules, TurboModuleRegistry } from 'react-native';

import {
  MAX_VIDEO_BYTES,
  MIN_VIDEO_VIDEO_BITRATE,
  THUMBNAIL_JPEG_QUALITY,
  THUMBNAIL_MAX_DIMENSION,
  VIDEO_TARGET_BYTES,
} from '../constants/media';
import { planVideoCompression, type VideoCompressionPlan } from '../lib/media/videoBudget';
import { thumbnailDirectory } from '../lib/media/paths';

const COMPRESSION_ATTEMPTS = 3;

export const COMPRESSION_UNAVAILABLE_MESSAGE =
  'Video compression needs the Folio development build. Rebuild the app with npx expo run:android (or run:ios) and try again.';

type VideoCompressorModule = typeof import('react-native-compressor');

let compressorPromise: Promise<VideoCompressorModule | null> | null = null;

/**
 * The compressor constructs a NativeEventEmitter while its module evaluates,
 * so a static import crashes the whole route in Expo Go or a stale dev build.
 * Check the registry first, then load lazily. An unavailable native module is
 * treated as "no compression" rather than a fatal error.
 */
function compressorLinked(): boolean {
  try {
    return Boolean(TurboModuleRegistry.get('Compressor') ?? NativeModules.Compressor);
  } catch {
    return false;
  }
}

function loadVideoCompressor(): Promise<VideoCompressorModule | null> {
  if (!compressorPromise) {
    compressorPromise = compressorLinked()
      ? import('react-native-compressor')
          .then((module) => module)
          .catch(() => null)
      : Promise.resolve(null);
  }
  return compressorPromise;
}

export class VideoTooLargeError extends Error {
  constructor(message = 'This clip is too large to fit in 25 MB. Try a shorter clip.') {
    super(message);
    this.name = 'VideoTooLargeError';
  }
}

export interface VideoPreparationInput {
  uri: string;
  durationMs?: number;
  width?: number | null;
  height?: number | null;
  sizeBytes?: number | null;
  mimeType?: string;
}

export interface VideoPreparationProgress {
  stage: 'compressing';
  fraction?: number;
}

export interface GeneratedThumbnail {
  uri: string;
  width: number;
  height: number;
}

export interface PreparedVideo {
  uri: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationMs: number;
  thumbnail: GeneratedThumbnail | null;
}

interface VideoMetadata {
  width: number | null;
  height: number | null;
  durationMs: number;
  sizeBytes: number;
}

/** Native modules return bare paths on some platforms; expo-file-system needs a URI. */
export function normalizeFileUri(uri: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri)) return uri;
  return uri.startsWith('/') ? `file://${uri}` : `file:///${uri}`;
}

function fileSize(uri: string): number {
  try {
    const file = new File(normalizeFileUri(uri));
    return file.exists ? file.size : 0;
  } catch {
    return 0;
  }
}

async function readMetadata(uri: string): Promise<VideoMetadata | null> {
  const compressor = await loadVideoCompressor();
  if (!compressor) return null;
  try {
    const meta = await compressor.getVideoMetaData(normalizeFileUri(uri));
    if (!meta || !Number.isFinite(meta.width) || !Number.isFinite(meta.height)) return null;
    if (meta.width <= 0 || meta.height <= 0) return null;
    return {
      width: Math.round(meta.width),
      height: Math.round(meta.height),
      durationMs: Number.isFinite(meta.duration) ? Math.round(meta.duration * 1000) : 0,
      sizeBytes: Number.isFinite(meta.size) ? meta.size : fileSize(uri),
    };
  } catch {
    return null;
  }
}

/**
 * Extracts a frame, downscales it and re-encodes a small JPEG so covers are
 * cheap to store and upload. Returns null when the platform cannot decode the
 * video; publishing still proceeds without a cover.
 */
export async function generateVideoThumbnail(uri: string): Promise<GeneratedThumbnail | null> {
  const compressor = await loadVideoCompressor();
  if (!compressor) return null;
  try {
    const created = await compressor.createVideoThumbnail(normalizeFileUri(uri), { quality: 0.85 });
    const sourceUri = normalizeFileUri(created.path);
    const width = Number.isFinite(created.width) ? created.width : 0;
    const height = Number.isFinite(created.height) ? created.height : 0;
    const longSide = Math.max(width, height);

    const context = ImageManipulator.manipulate(sourceUri);
    if (longSide > THUMBNAIL_MAX_DIMENSION) {
      if (width >= height) {
        context.resize({ width: THUMBNAIL_MAX_DIMENSION, height: null });
      } else {
        context.resize({ width: null, height: THUMBNAIL_MAX_DIMENSION });
      }
    }
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: THUMBNAIL_JPEG_QUALITY });
    if (!saved.uri) return null;
    return { uri: saved.uri, width: saved.width, height: saved.height };
  } catch {
    return null;
  }
}

/** Copies a generated cover into the private archive and returns its file. */
export async function storeThumbnail(sourceUri: string, clipId: string): Promise<File> {
  const source = new File(normalizeFileUri(sourceUri));
  if (!source.exists || source.size <= 0) throw new Error('The thumbnail could not be saved');
  const destination = new File(thumbnailDirectory(), `${clipId}.jpg`);
  if (destination.exists) destination.delete();
  await source.copy(destination);
  return destination;
}

async function compressToBudget(
  sourceUri: string,
  plan: VideoCompressionPlan,
  onProgress?: (progress: VideoPreparationProgress) => void
): Promise<{ uri: string; sizeBytes: number }> {
  const compressor = await loadVideoCompressor();
  if (!compressor) throw new Error(COMPRESSION_UNAVAILABLE_MESSAGE);

  let bitrate = plan.bitrate;
  let lastSize = 0;

  for (let attempt = 0; attempt < COMPRESSION_ATTEMPTS; attempt += 1) {
    onProgress?.({ stage: 'compressing', fraction: 0 });
    const output = await compressor.Video.compress(
      normalizeFileUri(sourceUri),
      {
        compressionMethod: 'manual',
        maxSize: plan.maxSize,
        bitrate,
        minimumFileSizeForCompress: 0,
        progressDivider: 4,
      },
      (fraction) => {
        // Android reports 0-100, iOS reports 0-1.
        const normalized = fraction > 1 ? fraction / 100 : fraction;
        onProgress?.({ stage: 'compressing', fraction: Math.min(1, Math.max(0, normalized)) });
      }
    );

    const outputFile = new File(normalizeFileUri(output));
    if (!outputFile.exists || outputFile.size <= 0) {
      throw new Error('The video could not be compressed');
    }
    lastSize = outputFile.size;

    if (lastSize <= MAX_VIDEO_BYTES) {
      return { uri: outputFile.uri, sizeBytes: lastSize };
    }
    outputFile.delete();
    if (attempt === COMPRESSION_ATTEMPTS - 1) break;

    // Re-encode from the original each time to avoid stacking quality loss.
    const scale = (VIDEO_TARGET_BYTES / lastSize) * 0.92;
    bitrate = Math.max(Math.floor(MIN_VIDEO_VIDEO_BITRATE / 2), Math.floor(bitrate * scale));
  }

  throw new VideoTooLargeError(
    `This clip compressed to ${Math.ceil(lastSize / (1024 * 1024))} MB, above the 25 MB limit. Try a shorter clip.`
  );
}

/**
 * Normalizes a picked or recorded clip for storage: caps it at 1080p, keeps it
 * under 25 MB and produces a small JPEG cover.
 */
export async function prepareVideoForPublish(
  input: VideoPreparationInput,
  onProgress?: (progress: VideoPreparationProgress) => void
): Promise<PreparedVideo> {
  const fallbackSize = input.sizeBytes ?? fileSize(input.uri);
  const compressor = await loadVideoCompressor();
  if (!compressor) {
    // Keep the app usable in Expo Go / stale development builds. Clips that
    // are already small enough publish unchanged; oversized ones explain why
    // they cannot be compressed yet.
    if (fallbackSize > MAX_VIDEO_BYTES) {
      throw new VideoTooLargeError(COMPRESSION_UNAVAILABLE_MESSAGE);
    }
    return {
      uri: input.uri,
      mimeType: input.mimeType ?? 'video/mp4',
      sizeBytes: fallbackSize,
      width: input.width ?? null,
      height: input.height ?? null,
      durationMs: Math.max(0, input.durationMs ?? 0),
      thumbnail: null,
    };
  }

  const metadata = await readMetadata(input.uri);
  const width = metadata?.width ?? (input.width ?? null);
  const height = metadata?.height ?? (input.height ?? null);
  const durationMs = metadata?.durationMs || Math.max(0, input.durationMs ?? 0);
  const sizeBytes = metadata?.sizeBytes ?? fallbackSize;

  if (!metadata && sizeBytes > MAX_VIDEO_BYTES) {
    throw new VideoTooLargeError(
      'This video could not be prepared for upload. Export it as an MP4 and try again.'
    );
  }

  const plan = planVideoCompression({ width, height, durationMs, sizeBytes });
  let finalUri = input.uri;
  let finalSize = sizeBytes;
  let finalMimeType = input.mimeType ?? 'video/mp4';

  if (plan.needsCompression) {
    if (!plan.feasible) {
      throw new VideoTooLargeError(
        'This clip is too long to fit in 25 MB. Try a shorter clip or trim it first.'
      );
    }
    const compressed = await compressToBudget(input.uri, plan, onProgress);
    finalUri = compressed.uri;
    finalSize = compressed.sizeBytes;
    finalMimeType = 'video/mp4';
  }

  const finalMetadata = await readMetadata(finalUri);
  const thumbnail = await generateVideoThumbnail(finalUri);

  return {
    uri: finalUri,
    mimeType: finalMimeType,
    sizeBytes: finalMetadata?.sizeBytes ?? finalSize,
    width: finalMetadata?.width ?? width,
    height: finalMetadata?.height ?? height,
    durationMs: finalMetadata?.durationMs || durationMs,
    thumbnail,
  };
}
