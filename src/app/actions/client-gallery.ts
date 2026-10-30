"use server";

import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase/service";
import { requireGallerySession } from "@/lib/auth/gallery";
import { revalidatePath } from "next/cache";
import { notifySelectionConfirmation } from "@/lib/notifications/whatsapp/dispatcher";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "ID tidak valid.");

export async function toggleFavorite(projectId: string, mediaId: string, _locator?: string): Promise<{ isFavorited: boolean; error?: string }> {
  if (!uuid.safeParse(projectId).success || !uuid.safeParse(mediaId).success) return { isFavorited: false, error: "Invalid media." };
  const session = await requireGallerySession(projectId).catch(() => null);
  if (!session) return { isFavorited: false, error: "Not authenticated." };
  const supabase = createServiceSupabase();
  const { data: project } = await supabase.from("projects").select("id, selection_locked_at").eq("id", projectId).maybeSingle();
  if (project?.selection_locked_at) {
    return { isFavorited: false, error: "Pilihan foto telah dikunci dan masuk antrean editing." };
  }
  const { data: media } = await supabase.from("media").select("id, project_id").eq("id", mediaId).eq("project_id", projectId).maybeSingle();
  if (!media) return { isFavorited: false, error: "Media not found." };
  const { data: existing } = await supabase.from("favorites").select("id").eq("project_id", projectId).eq("media_id", mediaId).eq("session_id", session.session_id).maybeSingle();
  if (existing) {
    await supabase.from("favorites").delete().eq("id", existing.id);
    if (_locator) revalidatePath(`/gallery/${_locator}`);
    return { isFavorited: false };
  }
  const { error } = await supabase.from("favorites").insert({ project_id: projectId, media_id: mediaId, session_id: session.session_id });
  if (!error && _locator) revalidatePath(`/gallery/${_locator}`);
  return error ? { isFavorited: false, error: "Could not save favorite." } : { isFavorited: true };
}

export async function getSessionFavorites(projectId: string, _locator?: string): Promise<string[]> {
  const session = await requireGallerySession(projectId).catch(() => null);
  if (!session) return [];
  const { data } = await createServiceSupabase().from("favorites").select("media_id").eq("project_id", projectId).eq("session_id", session.session_id);
  return ((data ?? []) as { media_id: string }[]).map((row) => row.media_id);
}

export async function getMediaDownloadUrl(mediaId: string, projectId: string, _locator?: string): Promise<{ url?: string; error?: string }> {
  if (!uuid.safeParse(projectId).success || !uuid.safeParse(mediaId).success) return { error: "Invalid media." };
  const session = await requireGallerySession(projectId).catch(() => null);
  if (!session) return { error: "Not authenticated." };
  const supabase = createServiceSupabase();
  let project: { id: string; allow_download: boolean; is_fully_paid: boolean } | null = null;
  const { data: fullProject } = await supabase.from("projects").select("id, allow_download, is_fully_paid").eq("id", projectId).maybeSingle();
  if (fullProject) {
    project = fullProject as { id: string; allow_download: boolean; is_fully_paid: boolean };
  } else {
    const { data: baseProject } = await supabase.from("projects").select("id, allow_download").eq("id", projectId).maybeSingle();
    if (baseProject) {
      project = { id: baseProject.id, allow_download: (baseProject as { allow_download: boolean }).allow_download, is_fully_paid: false };
    }
  }
  if (!project?.allow_download) return { error: "Downloads are not enabled for this gallery." };
  if (!project.is_fully_paid) return { error: "Aset resolusi tinggi terkunci hingga pelunasan invoice 100% terverifikasi." };
  const { data: media } = await supabase.from("media").select("id").eq("id", mediaId).eq("project_id", projectId).maybeSingle();
  if (!media) return { error: "Media not found." };
  return { url: `/api/media/${mediaId}/download` };
}

export async function submitPhotoSelection(
  projectId: string,
  _locator?: string
): Promise<{ success: boolean; error?: string }> {
  if (!uuid.safeParse(projectId).success) return { success: false, error: "Invalid project ID." };
  const session = await requireGallerySession(projectId).catch(() => null);
  if (!session) return { success: false, error: "Not authenticated." };

  const supabase = createServiceSupabase();
  const { error } = await supabase.rpc("submit_photo_selection", {
    p_project_id: projectId,
    p_session_id: session.session_id,
  });

  if (error) {
    return { success: false, error: error.message || "Failed to submit photo selection." };
  }
  if (_locator) {
    revalidatePath(`/gallery/${_locator}`);
  }

  // Asynchronous out-of-band WhatsApp confirmation
  (async () => {
    try {
      const { data: project } = await supabase
        .from("projects")
        .select("id, name, customer_id, customers!inner(name, phone)")
        .eq("id", projectId)
        .maybeSingle();

      const { count } = await supabase
        .from("favorites")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .eq("session_id", session.session_id);

      const customer = (project as unknown as { customers: { name: string; phone: string | null } | null })?.customers;
      if (project && customer?.phone) {
        await notifySelectionConfirmation({
          projectId: project.id,
          clientName: customer.name,
          clientPhone: customer.phone,
          projectName: project.name,
          selectedCount: count || 0,
        });
      }
    } catch (notifyErr) {
      console.warn("[Gallery] Selection confirmation notification failed:", notifyErr);
    }
  })();

  return { success: true };
}
