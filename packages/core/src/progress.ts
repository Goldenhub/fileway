import type { UploadProgress } from "./types.js";

/**
 * Minimum time between progress callbacks for small chunks on fast streams.
 * Large or infrequent chunks report immediately (see `MIN_CHUNK_BYTES`).
 */
const THROTTLE_MS = 100;
/** A single chunk at least this large reports immediately, even inside a throttle window. */
const MIN_CHUNK_BYTES = 256 * 1024;
/** A chunk that moves the upload by at least this fraction of the known total reports immediately. */
const MIN_TOTAL_FRACTION = 0.05;

/**
 * Wraps a `ReadableStream<Uint8Array>` so `onProgress` fires as chunks flow
 * through. The stream is unchanged for the driver; only observability is added.
 *
 * Event cadence is adaptive: a chunk is "significant" (≥ 256 KiB, or ≥ 5% of a
 * known `total`) and reports immediately, otherwise callbacks are coalesced to
 * at most one per 100 ms. When the stream ends, an exact final event always
 * fires (bytes === total, progress === 1). The final event does not fire on
 * cancellation, so an aborted upload never reports a misleading 100%.
 */
export function withProgress(
  stream: ReadableStream<Uint8Array>,
  onProgress: (progress: UploadProgress) => void,
  total?: number,
): ReadableStream<Uint8Array> {
  let bytes = 0;
  let lastEmit = 0;

  const report = (loaded: number) => {
    const progress: UploadProgress = { bytes: loaded };
    if (total !== undefined) {
      progress.total = total;
      progress.progress = total === 0 ? 1 : Math.min(1, loaded / total);
    }
    onProgress(progress);
  };

  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        const now = Date.now();
        const significant =
          chunk.byteLength >= MIN_CHUNK_BYTES ||
          (total !== undefined && total > 0 && chunk.byteLength / total >= MIN_TOTAL_FRACTION);
        if (significant || now - lastEmit >= THROTTLE_MS) {
          report(bytes);
          lastEmit = now;
        }
        controller.enqueue(chunk);
      },
      flush() {
        report(bytes);
      },
    }),
  );
}
