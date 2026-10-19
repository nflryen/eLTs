import "server-only";

export type PreviewVariant = "thumbnail" | "preview";

/** Contract for the later gateway/worker. Never expose provider keys in client DTOs. */
export interface PrivateMediaStorage {
  openObject(
    key: string,
    options?: { range?: string; signal?: AbortSignal },
  ): Promise<{
    body: ReadableStream<Uint8Array>;
    contentType: string;
    contentLength: number;
    contentRange?: string;
    status: 200 | 206;
  }>;
  createUploadAuthorization(
    projectId: string,
    mediaId: string,
    mimeType: string,
    byteSize: number,
  ): Promise<{
    uploadUrl: string;
    objectKey: string;
    expiresAt: Date;
  }>;
  deleteObjects(keys: string[]): Promise<void>;
}
