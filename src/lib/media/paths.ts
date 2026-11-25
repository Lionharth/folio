import { Directory, File, Paths } from 'expo-file-system';

/** Private plaintext store for clips and their covers. */
export function mediaDirectory(): Directory {
  const dir = new Directory(Paths.document, 'folio-media');
  if (!dir.exists) dir.create();
  return dir;
}

/** Persistent, small JPEG covers shown in the feed. */
export function thumbnailDirectory(): Directory {
  const dir = new Directory(mediaDirectory(), 'thumbs');
  if (!dir.exists) dir.create();
  return dir;
}

/** Scratch space for encrypted uploads. */
export function workDirectory(): Directory {
  const dir = new Directory(Paths.cache, 'folio-work');
  if (!dir.exists) dir.create();
  return dir;
}

export function thumbnailFile(clipId: string): File {
  return new File(thumbnailDirectory(), `${clipId}.jpg`);
}
