import { Directory, File, FileMode, Paths } from 'expo-file-system';

import { decryptFc1Stream, encryptStreamToFc1, FC1_DEFAULT_CHUNK, type DecodedFc1Header } from './chunkedFile';
import { expoAesGcm, expoRandom } from './expoAes';

export interface EncryptedMediaResult {
  encryptedFile: File;
  sha256: string;
  encryptedSize: number;
  plaintextSize: number;
  chunkCount: number;
}

function openReader(file: File) {
  const handle = file.open(FileMode.ReadOnly);
  return {
    reader: {
      async read(length: number) {
        return handle.readBytes(length);
      },
    },
    close: () => handle.close(),
  };
}

function openWriter(file: File) {
  if (file.exists) file.delete();
  file.create();
  const handle = file.open(FileMode.ReadWrite);
  let offset = 0;
  return {
    writer: {
      async write(bytes: Uint8Array) {
        handle.offset = offset;
        await handle.writeBytes(bytes);
        offset += bytes.length;
      },
    },
    close: () => handle.close(),
  };
}

export async function encryptMediaFile(
  source: File,
  destination: File,
  key: Uint8Array,
  options: { chunkSize?: number; onProgress?: (processed: number, total: number) => void } = {}
): Promise<EncryptedMediaResult> {
  const total = source.size;
  const sourceHandle = openReader(source);
  const destinationHandle = openWriter(destination);
  try {
    const result = await encryptStreamToFc1({
      reader: sourceHandle.reader,
      writer: destinationHandle.writer,
      key,
      aes: expoAesGcm,
      random: expoRandom,
      chunkSize: options.chunkSize ?? FC1_DEFAULT_CHUNK,
      plaintextSize: total,
      onProgress: (processed) => options.onProgress?.(processed, total),
    });
    const sha256 = await destination.digest('SHA-256');
    return {
      encryptedFile: destination,
      sha256,
      encryptedSize: result.encryptedSize,
      plaintextSize: result.plaintextSize,
      chunkCount: result.chunkCount,
    };
  } finally {
    sourceHandle.close();
    destinationHandle.close();
  }
}

export async function decryptMediaFile(
  source: File,
  destination: File,
  key: Uint8Array,
  options: { onProgress?: (processed: number) => void } = {}
): Promise<DecodedFc1Header> {
  const sourceHandle = openReader(source);
  const destinationHandle = openWriter(destination);
  try {
    return await decryptFc1Stream({
      reader: sourceHandle.reader,
      writer: destinationHandle.writer,
      key,
      aes: expoAesGcm,
      onProgress: options.onProgress,
    });
  } finally {
    sourceHandle.close();
    destinationHandle.close();
  }
}

export function mediaCacheFile(name: string): File {
  const dir = new Directory(Paths.cache, 'folio-media');
  if (!dir.exists) dir.create();
  return new File(dir, name);
}
