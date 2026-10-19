import { UPLOAD_CHUNK_BYTES, type SignedMediaUpload, type UploadReceipt } from "./policy";

interface ChunkResponse {
  public_id?: string;
  version?: number;
  signature?: string;
  done?: boolean;
  error?: { message?: string };
}

export class UploadRequestError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}

export interface UploadChunkRequest {
  endpoint: string;
  fields: Record<string, string>;
  chunk: Blob;
  fileName: string;
  uploadId: string;
  start: number;
  end: number;
  total: number;
  signal?: AbortSignal;
  onProgress: (bytes: number) => void;
}

/** XHR exposes actual upload progress; the file bytes go directly to Cloudinary. */
export function sendUploadChunk(request: UploadChunkRequest): Promise<ChunkResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    if (request.signal?.aborted) { reject(new Error("Upload cancelled.")); return; }
    xhr.open("POST", request.endpoint);
    xhr.timeout = 180_000;
    xhr.setRequestHeader("X-Unique-Upload-Id", request.uploadId);
    xhr.setRequestHeader("Content-Range", `bytes ${request.start}-${request.end - 1}/${request.total}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) request.onProgress(Math.min(request.chunk.size, event.loaded / event.total * request.chunk.size));
    };
    xhr.onloadend = () => request.signal?.removeEventListener("abort", abort);
    xhr.onerror = () => reject(new UploadRequestError("Network error. Check your connection and retry.", true));
    xhr.ontimeout = () => reject(new UploadRequestError("Upload timed out. Check your connection and retry.", true));
    xhr.onabort = () => reject(new Error("Upload cancelled."));
    xhr.onload = () => {
      let response: ChunkResponse;
      try { response = JSON.parse(xhr.responseText) as ChunkResponse; }
      catch { reject(new UploadRequestError("Cloudinary returned an invalid response. Please retry.", xhr.status >= 500)); return; }
      if (xhr.status < 200 || xhr.status >= 300) {
        const providerMessage = response.error?.message?.slice(0, 240) ?? `Upload rejected (${xhr.status}).`;
        const message = /too large|maximum.*size|file size|exceed.*limit/i.test(providerMessage)
          ? `Cloudinary account limit: ${providerMessage} Check the account's upload limits; chunking cannot increase them.`
          : providerMessage;
        reject(new UploadRequestError(message, xhr.status === 429 || xhr.status >= 500));
        return;
      }
      resolve(response);
    };
    const body = new FormData();
    for (const [key, value] of Object.entries(request.fields)) body.append(key, value);
    body.append("file", request.chunk, request.fileName);
    request.signal?.addEventListener("abort", abort, { once: true });
    xhr.send(body);
  });
}

export async function uploadInChunks(
  file: File,
  upload: SignedMediaUpload,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
  send = sendUploadChunk,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<UploadReceipt> {
  // The ID stays identical across chunks and retries of one transfer.
  const uploadId = crypto.randomUUID();
  let response: ChunkResponse | undefined;
  for (let start = 0; start < file.size; start += UPLOAD_CHUNK_BYTES) {
    const end = Math.min(start + UPLOAD_CHUNK_BYTES, file.size);
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw new Error("Upload cancelled.");
      try {
        response = await send({
          endpoint: upload.endpoint, fields: upload.fields,
          chunk: file.slice(start, end), fileName: file.name,
          uploadId, start, end, total: file.size, signal,
          onProgress: (bytes) => onProgress(Math.min(99, Math.floor((start + bytes) / file.size * 100))),
        });
        break;
      } catch (error) {
        if (!(error instanceof UploadRequestError) || !error.retryable || attempt >= 2 || signal?.aborted) throw error;
        await wait(1000 * 2 ** attempt);
      }
    }
  }
  if (response?.done === false || response?.public_id !== upload.publicId ||
      typeof response.version !== "number" || typeof response.signature !== "string") {
    throw new Error("Cloudinary did not confirm the completed upload. Please retry.");
  }
  return { publicId: response.public_id, version: response.version, signature: response.signature };
}

/** A failure never prevents the remaining items from being attempted. */
export async function runUploadQueue<T>(items: readonly T[], concurrency: number, upload: (item: T) => Promise<void>) {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(items.length, concurrency) }, async () => {
    while (index < items.length) {
      const item = items[index++];
      await upload(item);
    }
  }));
}
