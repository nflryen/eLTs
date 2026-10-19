import { fileUploadMetadata, type SignedMediaUpload, type UploadMetadata, type UploadReceipt } from "./policy";

export interface UploadSession {
  file: File;
  upload?: SignedMediaUpload;
  receipt?: UploadReceipt;
}

interface UploadServices {
  prepare: (metadata: UploadMetadata) => Promise<{ upload?: SignedMediaUpload; error?: string }>;
  transfer: (file: File, upload: SignedMediaUpload, onProgress: (progress: number) => void) => Promise<UploadReceipt>;
  complete: (intent: string, receipt: UploadReceipt) => Promise<{ success: boolean; error?: string }>;
}

export interface UploadProgress {
  state: "uploading" | "saving" | "done";
  progress: number;
}

/** Keep the receipt before finalization so a failed save can be retried without sending the file again. */
export async function runUploadSession(
  session: UploadSession,
  services: UploadServices,
  onProgress: (progress: UploadProgress) => void,
) {
  if (!session.upload || !session.receipt) {
    onProgress({ state: "uploading", progress: 0 });
    const prepared = await services.prepare(fileUploadMetadata(session.file));
    if (!prepared.upload) throw new Error(prepared.error ?? "Could not start upload.");
    session.upload = prepared.upload;
    session.receipt = await services.transfer(session.file, prepared.upload, (progress) => {
      onProgress({ state: "uploading", progress });
    });
  }

  onProgress({ state: "saving", progress: 100 });
  const saved = await services.complete(session.upload.intent, session.receipt);
  if (!saved.success) throw new Error(saved.error ?? "Could not save uploaded media.");
  onProgress({ state: "done", progress: 100 });
}
