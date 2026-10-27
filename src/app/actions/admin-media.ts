"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { requireOps } from "@/lib/auth/roles";
import {
  createCloudinaryUpload,
  getVerifiedCloudinaryUpload,
  deleteFromCloudinary,
} from "@/services/cloudinary";
import { getCloudinaryConfig } from "@/lib/env";
import { signUploadIntent, verifyUploadIntent, type UploadIntent } from "@/lib/security/upload-intent";
import { uploadMetadataSchema, type SignedMediaUpload, type UploadReceipt } from "@/lib/uploads/policy";
import type { Database, ProjectStatus } from "@/types/database";
import { z } from "zod";

// The application only receives small metadata payloads. File bytes go to Cloudinary.
export async function prepareProjectMediaUpload(
  projectId: string,
  metadata: unknown,
): Promise<{ upload: SignedMediaUpload; error?: never } | { error: string; upload?: never }> {
  try {
    const { supabase, admin } = await requireOps();
    const parsed = uploadMetadataSchema.safeParse(metadata);
    if (!z.uuid().safeParse(projectId).success || !parsed.success) return { error: "Invalid file or project. Photos: up to 100 MB; videos: up to 2 GB." };
    const { data: project, error } = await supabase.from("projects").select("id, status").eq("id", projectId).single();
    if (error || !project) return { error: "Project not found." };
    if (project.status === "archived") return { error: "Restore this project before uploading media." };

    // Check the deployed schema before transferring bytes to Cloudinary. An
    // unapplied migration must not leave an uploaded file that cannot be saved.
    const { error: schemaError } = await supabase.from("media").select("cloudinary_delivery_type").limit(0);
    if (schemaError) {
      console.error("[media-upload] prepare database check failed", { code: schemaError.code });
      return { error: schemaError.code === "42703" || schemaError.code === "PGRST204"
        ? "Uploads need a database update. Apply the latest Supabase migrations, then retry. Your file has not been uploaded."
        : "The media database is unavailable. Please retry in a moment. Your file has not been uploaded." };
    }
    const mediaId = randomUUID();
    const intent: UploadIntent = {
      metadata: parsed.data,
      adminId: admin.user_id,
      projectId, mediaId, publicId: `elts/${projectId}/${mediaId}`,
      resourceType: parsed.data.mimeType.startsWith("video/") ? "video" : "image",
      expiresAt: Date.now() + 2 * 60 * 60 * 1000,
    };
    const token = signUploadIntent(intent, getCloudinaryConfig().apiSecret);
    return { upload: createCloudinaryUpload(intent, token) };
  } catch {
    return { error: "Unable to start upload. Check your admin login and Cloudinary configuration." };
  }
}

const receiptSchema = z.object({ publicId: z.string().max(200), version: z.number().int().positive(), signature: z.string().regex(/^[a-f0-9]{40,64}$/) });

export async function completeProjectMediaUpload(
  token: string,
  receipt: UploadReceipt,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, admin } = await requireOps();
    const intent = verifyUploadIntent(token, getCloudinaryConfig().apiSecret, admin.user_id);
    const parsed = receiptSchema.safeParse(receipt);
    if (!intent || !parsed.success) return { success: false, error: "Upload authorization expired or invalid. Select the file again." };
    const { data: project } = await supabase.from("projects").select("id, status").eq("id", intent.projectId).single();
    if (!project || project.status === "archived") return { success: false, error: "This project is no longer available for uploads." };

    // Finalization is idempotent: retries cannot create duplicate records or delete a saved asset.
    const { data: existing, error: existingError } = await supabase.from("media").select("id, project_id, cloudinary_public_id").eq("id", intent.mediaId).maybeSingle();
    if (existingError) return { success: false, error: "Could not check upload status. Please retry." };
    if (existing) return { success: existing.project_id === intent.projectId && existing.cloudinary_public_id === intent.publicId };

    const resource = await getVerifiedCloudinaryUpload(intent, parsed.data);
    const row: Database["public"]["Tables"]["media"]["Insert"] = {
      id: intent.mediaId,
      project_id: intent.projectId,
      type: intent.resourceType,
      file_name: intent.metadata.fileName,
      mime_type: resource.mimeType,
      storage_provider: "cloudinary",
      cloudinary_delivery_type: "authenticated",
      original_key: intent.publicId,
      thumbnail_key: `/api/media/${intent.mediaId}/preview?variant=thumbnail`,
      preview_key: `/api/media/${intent.mediaId}/preview?variant=preview`,
      cloudinary_public_id: intent.publicId,
      width: resource.width,
      height: resource.height,
      file_size: resource.bytes,
      duration_seconds: resource.duration ?? null,
      processing_status: "ready",
      sort_order: 0,
    };
    const { error: dbError } = await supabase.from("media").upsert(row, { onConflict: "id", ignoreDuplicates: true });
    if (dbError) {
      console.error("[media-upload] save failed", { code: dbError.code });
      // Retain the authenticated asset for a safe finalize retry after transient database errors.
      return { success: false, error: "File uploaded but could not be saved. Retry to save it without uploading again. Check that database migrations have been applied." };
    }
    revalidatePath(`/admin/projects/${intent.projectId}/media`);
    return { success: true };
  } catch {
    return { success: false, error: "Could not verify and save the uploaded file. Check your admin login and retry; Cloudinary verification may be temporarily unavailable." };
  }
}

// ── Delete Media ─────────────────────────────────────────────────────────────

export async function deleteProjectMedia(mediaId: string): Promise<{ error?: string }> {
  const { supabase } = await requireOps();

  if (!z.string().uuid().safeParse(mediaId).success) {
    return { error: "Invalid media ID." };
  }

  const { data: media } = await supabase
    .from("media")
    .select("id, project_id, cloudinary_public_id, cloudinary_delivery_type, type")
    .eq("id", mediaId)
    .single();

  if (!media) return { error: "Media not found." };

  const m = media as {
    id: string;
    project_id: string;
    cloudinary_public_id: string | null;
    cloudinary_delivery_type: "upload" | "authenticated" | null;
    type: string;
  };

  // Delete from Cloudinary first
  if (m.cloudinary_public_id) {
    await deleteFromCloudinary(
      m.cloudinary_public_id,
      m.type === "video" ? "video" : "image",
      m.cloudinary_delivery_type ?? "upload",
    ).catch(() => { throw new Error("Could not delete the stored file. Please retry."); });
  }

  const { error: dbError } = await supabase
    .from("media")
    .delete()
    .eq("id", mediaId);

  if (dbError) return { error: dbError.message };

  revalidatePath(`/admin/projects/${m.project_id}/media`);
  return {};
}

// ── Update Project Status ─────────────────────────────────────────────────────

const validStatuses: ProjectStatus[] = [
  "draft",
  "editing",
  "ready",
  "expired",
  "archived",
];

export async function updateProjectStatus(
  projectId: string,
  status: ProjectStatus,
): Promise<{ error?: string }> {
  // Use requireAdmin only for auth check; use a raw client for the update
  // because the typed client's update() signature is overly strict here.
  await requireOps();
  const { createClient } = await import("@supabase/supabase-js");
  const rawSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  if (!validStatuses.includes(status)) {
    return { error: "Invalid status." };
  }

  const { error } = await rawSupabase
    .from("projects")
    .update({ status })
    .eq("id", projectId);

  if (error) return { error: error.message };

  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath("/admin/projects");
  return {};
}

/**
 * Direct Client-to-Cloudinary signed upload preparation for portfolio images.
 * Completely bypasses Vercel/Next.js serverless payload limits (HTTP 413)
 * by allowing the browser to transfer bytes directly to Cloudinary.
 * Restricted to Staff/Admin (rank >= 80).
 */
export async function prepareDirectPortfolioUploadAction(folder: string = "portfolio"): Promise<{
  success: boolean;
  upload?: {
    endpoint: string;
    fields: {
      timestamp: string;
      folder: string;
      api_key: string;
      signature: string;
    };
  };
  error?: string;
}> {
  try {
    await requireOps();
    const { cloudName, apiKey, apiSecret } = getCloudinaryConfig();
    const cleanSlug = folder.replace(/^\/+|\/+$/g, "") || "portfolio";
    const uploadFolder = cleanSlug.startsWith("elts/") ? cleanSlug : `elts/${cleanSlug}`;
    const timestamp = String(Math.floor(Date.now() / 1000));

    const { v2: cloudinary } = await import("cloudinary");
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });

    const paramsToSign = {
      folder: uploadFolder,
      timestamp,
    };

    const signature = cloudinary.utils.api_sign_request(paramsToSign, apiSecret);

    return {
      success: true,
      upload: {
        endpoint: `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`,
        fields: {
          timestamp,
          folder: uploadFolder,
          api_key: apiKey,
          signature,
        },
      },
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Gagal menyiapkan izin unggah langsung.",
    };
  }
}
