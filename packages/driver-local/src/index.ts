import type { BaseDriver, UploadOptions, UploadResult } from "@betterpush/core";
import { createWriteStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { Readable } from "node:stream";

const randomUUID = () => globalThis.crypto.randomUUID();

export interface LocalDriverConfig {
  directory: string;
  baseUrl?: string;
}

export class LocalDriver implements BaseDriver<{ localPath: string }> {
  readonly name = "local";
  private directory: string;
  private baseUrl: string;

  constructor(config: LocalDriverConfig) {
    this.directory = config.directory;
    this.baseUrl = config.baseUrl ?? `file://${config.directory}`;
  }

  async upload(
    stream: ReadableStream<Uint8Array>,
    options: UploadOptions,
  ): Promise<UploadResult<{ localPath: string }>> {
    const id = randomUUID();
    const ext = options.filename.includes(".") ? options.filename.split(".").pop()! : "";
    const filename = ext ? `${id}.${ext}` : id;
    const relativePath = options.path ? join(options.path, filename) : filename;
    const fullPath = join(this.directory, relativePath);

    await mkdir(dirname(fullPath), { recursive: true });

    const nodeStream = Readable.fromWeb(stream as any);
    const writeStream = createWriteStream(fullPath);

    const size = await new Promise<number>((resolve, reject) => {
      let bytes = 0;
      nodeStream.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
      });
      nodeStream.pipe(writeStream);
      writeStream.on("finish", () => resolve(bytes));
      writeStream.on("error", reject);
      nodeStream.on("error", reject);
    });

    return {
      id,
      url: `${this.baseUrl}/${relativePath}`,
      path: relativePath,
      size,
      meta: { localPath: fullPath },
    };
  }

  async delete(path: string): Promise<boolean> {
    try {
      await unlink(join(this.directory, path));
      return true;
    } catch {
      return false;
    }
  }

  async getUrl(path: string): Promise<string> {
    return `${this.baseUrl}/${path}`;
  }
}
