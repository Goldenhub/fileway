export interface UploadOptions {
  filename: string;
  mimeType?: string;
  path?: string;
  metadata?: Record<string, string>;
}

export interface UploadResult<TMeta extends Record<string, unknown>> {
  id: string;
  url: string;
  path: string;
  size: number;
  meta: TMeta;
}

export interface BaseDriver<TMeta extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  upload(
    stream: ReadableStream<Uint8Array>,
    options: UploadOptions,
  ): Promise<UploadResult<TMeta>>;
  delete(path: string): Promise<boolean>;
  getUrl(path: string): Promise<string>;
}

export interface MiddlewareHook {
  beforeUpload?: (
    stream: ReadableStream<Uint8Array>,
    options: UploadOptions,
  ) => Promise<
    | { stream?: ReadableStream<Uint8Array>; options?: UploadOptions }
    | void
  >;
  afterUpload?: (result: UploadResult<Record<string, unknown>>) => Promise<void>;
}

export interface FilewayConfig<TDriver extends BaseDriver> {
  driver: TDriver;
  middlewares?: MiddlewareHook[];
}