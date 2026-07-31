import type { BaseDriver, UploadOptions, UploadResult } from "@fileway/core";
import { validateUploadOptions, ValidationError, urlEncodePath, abortError, StorageError } from "@fileway/core";
import { createWriteStream, createReadStream } from "node:fs";
import { mkdir, unlink, access } from "node:fs/promises";
import { join, dirname, resolve, relative } from "node:path";
import { Readable } from "node:stream";

const randomUUID = () => globalThis.crypto.randomUUID();

export interface LocalDriverConfig {
  directory: string;
  baseUrl?: string;
  maxSizeBytes?: number;
}

export class LocalDriver implements BaseDriver<{ localPath: string }> {
  readonly name = "local";
  private directory: string;
  private baseUrl: string;
  private maxSizeBytes: number | undefined;

  constructor(config: LocalDriverConfig) {
    this.directory = config.directory;
    this.baseUrl = config.baseUrl ?? `file://${config.directory}`;
    this.maxSizeBytes = config.maxSizeBytes;
  }

  async upload(
    stream: ReadableStream<Uint8Array>,
    options: UploadOptions,
  ): Promise<UploadResult<{ localPath: string }>> {
    validateUploadOptions(options);

    const id = randomUUID();
    const ext = options.filename.includes(".") ? options.filename.split(".").pop()! : "";
    const filename = ext ? `${id}.${ext}` : id;
    const relativePath = options.path ? join(options.path, filename) : filename;
    const fullPath = resolve(join(this.directory, relativePath));

    if (!fullPath.startsWith(resolve(this.directory))) {
      throw new ValidationError("path escapes the configured storage directory");
    }

    await mkdir(dirname(fullPath), { recursive: true });

    const nodeStream = Readable.fromWeb(stream as any);
    const writeStream = createWriteStream(fullPath);

    const size = await new Promise<number>((resolve, reject) => {
      let bytes = 0;
      let finished = false;

      const cleanup = (err: unknown) => {
        nodeStream.destroy();
        writeStream.destroy();
        if (finished) {
          reject(err);
        } else {
          // Wait for the partial file to be removed so callers observing the
          // rejection can rely on the directory being clean.
          unlink(fullPath)
            .catch(() => {})
            .finally(() => reject(err));
        }
      };

      const onAbort = () => cleanup(abortError("upload aborted"));
      if (options.signal) {
        if (options.signal.aborted) {
          cleanup(abortError("upload aborted"));
          return;
        }
        options.signal.addEventListener("abort", onAbort, { once: true });
      }

      nodeStream.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (this.maxSizeBytes !== undefined && bytes > this.maxSizeBytes) {
          cleanup(new ValidationError(`upload exceeds maxSizeBytes of ${this.maxSizeBytes}`));
        }
      });
      nodeStream.pipe(writeStream);
      writeStream.on("finish", () => {
        finished = true;
        options.signal?.removeEventListener("abort", onAbort);
        resolve(bytes);
      });
      writeStream.on("error", cleanup);
      nodeStream.on("error", cleanup);
    });

    const safePath = urlEncodePath(relativePath);

    return {
      id,
      url: `${this.baseUrl}/${safePath}`,
      path: relativePath,
      size,
      meta: { localPath: fullPath },
    };
  }

  async delete(path: string): Promise<boolean> {
    try {
      const fullPath = resolve(join(this.directory, path));
      if (!fullPath.startsWith(resolve(this.directory))) {
        return false;
      }
      await unlink(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  async getUrl(path: string): Promise<string> {
    return `${this.baseUrl}/${urlEncodePath(path)}`;
  }

  async get(path: string): Promise<ReadableStream<Uint8Array>> {
    const fullPath = resolve(join(this.directory, path));
    if (!fullPath.startsWith(resolve(this.directory))) {
      throw new ValidationError(`path escapes the configured storage directory: ${path}`);
    }

    try {
      await access(fullPath);
    } catch {
      throw new StorageError("not-found", `file not found: ${path}`, { provider: "local" });
    }

    return Readable.toWeb(createReadStream(fullPath)) as ReadableStream<Uint8Array>;
  }
}
