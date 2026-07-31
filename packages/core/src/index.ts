export * from "./types.js";
export * from "./validation.js";
export * from "./progress.js";

export const version = "0.0.1";

import { BaseDriver, FilewayConfig, UploadOptions } from "./types.js";
import { withProgress } from "./progress.js";

export class FilewayClient<const TConfig extends FilewayConfig<BaseDriver>> {
  private driver: TConfig["driver"];
  private middlewares: NonNullable<TConfig["middlewares"]>;

  constructor(config: TConfig) {
    this.driver = config.driver;
    this.middlewares = config.middlewares ?? [];
  }

  async upload(
    stream: ReadableStream<Uint8Array>,
    options: UploadOptions,
  ): Promise<ReturnType<TConfig["driver"]["upload"]>> {
    let activeStream = stream;
    let activeOptions = { ...options };

    for (const middleware of this.middlewares) {
      if (middleware.beforeUpload) {
        const result = await middleware.beforeUpload(activeStream, activeOptions);
        if (result?.stream) activeStream = result.stream;
        if (result?.options) activeOptions = result.options;
      }
    }

    const progressStream = activeOptions.onProgress
      ? withProgress(activeStream, activeOptions.onProgress, activeOptions.size)
      : activeStream;

    const uploadResult = await this.driver.upload(progressStream, activeOptions);

    for (const middleware of this.middlewares) {
      if (middleware.afterUpload) {
        await middleware.afterUpload(uploadResult);
      }
    }

    return uploadResult as ReturnType<TConfig["driver"]["upload"]>;
  }

  async delete(path: string): Promise<boolean> {
    return this.driver.delete(path);
  }

  async getUrl(path: string): Promise<string> {
    return this.driver.getUrl(path);
  }

  get(path: string): Promise<ReadableStream<Uint8Array>> {
    return this.driver.get(path);
  }
}
