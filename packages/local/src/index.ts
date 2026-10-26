import type { BaseDriver, StoredObject, UploadOptions, UploadResult } from "@fileway/core";
import { validateUploadOptions, ValidationError, urlEncodePath, abortError, StorageError } from "@fileway/core";
import { createWriteStream, createReadStream } from "node:fs";
import { mkdir, unlink, access, lstat, rename, stat, readdir } from "node:fs/promises";
import { join, dirname, basename, resolve, relative, isAbsolute } from "node:path";
import { Readable } from "node:stream";

const randomUUID = () => globalThis.crypto.randomUUID();
// Suffix of in-progress upload files; see `upload` and `isPending`.
const PARTIAL_SUFFIX = ".partial";

export interface LocalDriverConfig {
  directory: string;
  baseUrl?: string;
  maxSizeBytes?: number;
}

export class LocalDriver implements BaseDriver<{ localPath: string }> {
  readonly name = "local";
  private directory: string;
  private resolvedDir: string;
  private baseUrl: string;
  private maxSizeBytes: number | undefined;

  constructor(config: LocalDriverConfig) {
    this.directory = config.directory;
    this.resolvedDir = resolve(config.directory);
    this.baseUrl = config.baseUrl ?? `file://${config.directory}`;
    this.maxSizeBytes = config.maxSizeBytes;
  }

  private resolveInside(userPath: string): string {
    const full = resolve(this.directory, userPath);
    const rel = relative(this.resolvedDir, full);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
      throw new ValidationError("path escapes the configured storage directory");
    }
    return full;
  }

  private async assertSafePath(fullPath: string): Promise<void> {
    const rel = relative(this.resolvedDir, fullPath);
    if (!rel) return;
    const parts = rel.split(/[\\/]/).filter(Boolean);
    let current = this.resolvedDir;
    for (const part of parts) {
      current = join(current, part);
      const st = await lstat(current).catch(() => null);
      if (st?.isSymbolicLink()) {
        throw new ValidationError("path traverses a symbolic link");
      }
    }
  }

  async upload(
    stream: ReadableStream<Uint8Array>,
    options: UploadOptions,
  ): Promise<UploadResult<{ localPath: string }>> {
    validateUploadOptions(options);

    const id = options.id ?? randomUUID();
    const relativePath = this.pathFor({ ...options, id });
    const fullPath = this.resolveInside(relativePath);

    await mkdir(dirname(fullPath), { recursive: true });
    await this.assertSafePath(fullPath);

    // Write to a temporary sibling and rename it into place when complete. A
    // retry that fails partway then never truncates or deletes a copy an
    // earlier attempt already finished, and readers never see a partial file.
    const tempPath = `${fullPath}.${randomUUID()}${PARTIAL_SUFFIX}`;
    const nodeStream = Readable.fromWeb(stream as any);
    const writeStream = createWriteStream(tempPath);

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
          unlink(tempPath)
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
          cleanup(new StorageError("size-exceeded", `upload exceeds maxSizeBytes of ${this.maxSizeBytes}`, { provider: "local" }));
        }
      });
      nodeStream.pipe(writeStream);
      writeStream.on("finish", () => {
        rename(tempPath, fullPath).then(() => {
          finished = true;
          options.signal?.removeEventListener("abort", onAbort);
          resolve(bytes);
        }, cleanup);
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

  /** The relative path an upload with `options.id` is stored at: `<path>/<id>.<ext>`. */
  pathFor(options: UploadOptions & { id: string }): string {
    const ext = options.filename.includes(".") ? options.filename.split(".").pop()! : "";
    const filename = ext ? `${options.id}.${ext}` : options.id;
    return options.path ? join(options.path, filename) : filename;
  }

  /**
   * The stored file at `path`, or `null` if there is none. Local disk keeps no
   * upload token, so `FilewayClient` verifies a recovered upload by size.
   */
  async head(path: string): Promise<StoredObject<{ localPath: string }> | null> {
    const fullPath = this.resolveInside(path);
    await this.assertSafePath(fullPath);
    const info = await stat(fullPath).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return null;
      throw new StorageError("provider-error", `failed to stat ${path}: ${err.message}`, { provider: "local", cause: err });
    });
    if (!info?.isFile()) return null;
    const name = basename(path);
    return {
      id: name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name,
      url: `${this.baseUrl}/${urlEncodePath(path)}`,
      path,
      size: info.size,
      meta: { localPath: fullPath },
      lastModified: info.mtime,
    };
  }

  /** Whether an upload to `path` is still being written (a `.partial` file exists). */
  async isPending(path: string): Promise<boolean> {
    const fullPath = this.resolveInside(path);
    const prefix = `${basename(fullPath)}.`;
    const entries = await readdir(dirname(fullPath)).catch(() => [] as string[]);
    return entries.some((entry) => entry.startsWith(prefix) && entry.endsWith(PARTIAL_SUFFIX));
  }

  /**
   * Deletes the file. Returns `false` when it does not exist; throws a
   * `ValidationError` for paths outside the storage directory and a
   * `StorageError` for any other filesystem failure.
   */
  async delete(path: string): Promise<boolean> {
    const fullPath = this.resolveInside(path);
    await this.assertSafePath(fullPath);
    try {
      await unlink(fullPath);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw new StorageError("provider-error", `failed to delete ${path}: ${(err as Error).message}`, {
        provider: "local",
        cause: err,
      });
    }
  }

  async getUrl(path: string): Promise<string> {
    return `${this.baseUrl}/${urlEncodePath(path)}`;
  }

  async get(path: string): Promise<ReadableStream<Uint8Array>> {
    const fullPath = this.resolveInside(path);
    await this.assertSafePath(fullPath);

    try {
      await access(fullPath);
    } catch {
      throw new StorageError("not-found", `file not found: ${path}`, { provider: "local" });
    }

    return Readable.toWeb(createReadStream(fullPath)) as ReadableStream<Uint8Array>;
  }
}
