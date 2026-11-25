/** Hard ceiling for an uploaded clip's plaintext payload. */
export const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

/** Leave room for the FC1 container so the encrypted upload stays under the cap. */
export const VIDEO_TARGET_BYTES = MAX_VIDEO_BYTES - 128 * 1024;

/** 1080p cap: the shorter side never exceeds this. */
export const MAX_VIDEO_SHORT_SIDE = 1080;

/** 1080p cap: the longer side is clamped to this (even for ultrawide sources). */
export const MAX_VIDEO_LONG_SIDE = 1920;

/** The encoder's audio track is fixed at 128 kbps. */
export const VIDEO_AUDIO_BITRATE = 128_000;

export const MIN_VIDEO_VIDEO_BITRATE = 160_000;
export const MAX_VIDEO_VIDEO_BITRATE = 8_000_000;

export const THUMBNAIL_MAX_DIMENSION = 720;
export const THUMBNAIL_JPEG_QUALITY = 0.62;
export const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
