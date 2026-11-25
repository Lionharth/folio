import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_VIDEO_BYTES,
  MAX_VIDEO_LONG_SIDE,
  MAX_VIDEO_SHORT_SIDE,
  MIN_VIDEO_VIDEO_BITRATE,
  VIDEO_AUDIO_BITRATE,
  VIDEO_TARGET_BYTES,
} from '../src/constants/media';
import { exceedsVideoCap, planVideoCompression, targetLongSide } from '../src/lib/media/videoBudget';

test('targetLongSide caps the short side at 1080 without upscaling', () => {
  assert.equal(targetLongSide(3840, 2160), MAX_VIDEO_LONG_SIDE);
  assert.equal(targetLongSide(2160, 3840), MAX_VIDEO_LONG_SIDE);
  assert.equal(targetLongSide(1920, 1080), MAX_VIDEO_LONG_SIDE);
  assert.equal(targetLongSide(1080, 1920), MAX_VIDEO_LONG_SIDE);
  assert.equal(targetLongSide(3840, 2880), 1440);
  assert.equal(targetLongSide(1280, 720), 1280);
  assert.equal(targetLongSide(640, 360), 640);
  assert.equal(targetLongSide(undefined, undefined), MAX_VIDEO_LONG_SIDE);
});

test('clips already inside both caps are left alone', () => {
  const plan = planVideoCompression({ width: 1280, height: 720, durationMs: 8000, sizeBytes: 4 * 1024 * 1024 });
  assert.equal(plan.needsCompression, false);
  assert.equal(plan.reason, null);
  assert.equal(plan.maxSize, 1280);
});

test('oversized 4K clips are capped to 1080p and a 25 MB bitrate budget', () => {
  const durationMs = 60_000;
  const plan = planVideoCompression({
    width: 3840,
    height: 2160,
    durationMs,
    sizeBytes: 80 * 1024 * 1024,
  });
  assert.equal(plan.needsCompression, true);
  assert.equal(plan.reason, 'both');
  assert.equal(plan.maxSize, 1920);
  assert.ok(plan.bitrate >= MIN_VIDEO_VIDEO_BITRATE);

  const budgetTotal = (VIDEO_TARGET_BYTES * 8 * 0.9) / (durationMs / 1000);
  assert.ok(plan.bitrate <= budgetTotal - VIDEO_AUDIO_BITRATE + 1);
});

test('a large but low-resolution clip is compressed for size only', () => {
  const plan = planVideoCompression({
    width: 1920,
    height: 1080,
    durationMs: 10_000,
    sizeBytes: 30 * 1024 * 1024,
  });
  assert.equal(plan.needsCompression, true);
  assert.equal(plan.reason, 'size');
  assert.equal(plan.maxSize, 1920);
});

test('a high-resolution clip already under 25 MB is compressed for resolution only', () => {
  const plan = planVideoCompression({
    width: 3840,
    height: 2160,
    durationMs: 10_000,
    sizeBytes: 5 * 1024 * 1024,
  });
  assert.equal(plan.needsCompression, true);
  assert.equal(plan.reason, 'resolution');
  assert.equal(plan.maxSize, 1920);
});

test('the requested bitrate never exceeds the source bitrate', () => {
  const durationMs = 10_000;
  const sizeBytes = 12 * 1024 * 1024;
  const plan = planVideoCompression({ width: 1920, height: 1080, durationMs, sizeBytes });
  const sourceTotal = (sizeBytes * 8) / (durationMs / 1000);
  assert.ok(plan.bitrate <= sourceTotal * 0.95 - VIDEO_AUDIO_BITRATE + 1);
});

test('clips too long for the budget are reported as infeasible', () => {
  const plan = planVideoCompression({
    width: 1920,
    height: 1080,
    durationMs: 30 * 60 * 1000,
    sizeBytes: 500 * 1024 * 1024,
  });
  assert.equal(plan.needsCompression, true);
  assert.equal(plan.feasible, false);
});

test('unknown dimensions force a conservative compression pass', () => {
  const plan = planVideoCompression({ durationMs: 5000, sizeBytes: 2 * 1024 * 1024 });
  assert.equal(plan.needsCompression, true);
  assert.equal(plan.reason, 'unknown');
  assert.equal(plan.maxSize, MAX_VIDEO_LONG_SIDE);
});

test('exceedsVideoCap uses the 25 MiB ceiling', () => {
  assert.equal(exceedsVideoCap(MAX_VIDEO_BYTES), false);
  assert.equal(exceedsVideoCap(MAX_VIDEO_BYTES + 1), true);
  assert.equal(targetLongSide(MAX_VIDEO_SHORT_SIDE, MAX_VIDEO_SHORT_SIDE), MAX_VIDEO_SHORT_SIDE);
});
