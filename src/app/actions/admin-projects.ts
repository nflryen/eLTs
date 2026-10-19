"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOps } from "@/lib/auth/roles";
import type { ProjectRow, ProjectStatus } from "@/types/database";
import {
  generateGalleryCode,
  generateAccessToken,
  hashGalleryPin,
} from "@/lib/security/tokens";
import { getPinPepper } from "@/lib/env";
import { z } from "zod";

const uuidSchema = z.string().uuid();
const photographyTypes = [
  "wedding",
  "prewedding",
  "graduation",
  "couple",
  "event",
] as const;

const createProjectSchema = z.object({
  customer_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Slug must be lowercase with hyphens"),
  photography_type: z.enum(photographyTypes),
  gallery_pin: z.string().min(4).max(12),
  shoot_date: z.string().optional().or(z.literal("")),
});

export async function createProject(state: unknown, formData: FormData) {
  const { supabase } = await requireOps();

  const raw = {
    customer_id: formData.get("customer_id")?.toString() ?? "",
    name: formData.get("name")?.toString() ?? "",
    slug: formData.get("slug")?.toString() ?? "",
    photography_type: formData.get("photography_type")?.toString() ?? "",
    gallery_pin: formData.get("gallery_pin")?.toString() ?? "",
    shoot_date: formData.get("shoot_date")?.toString() ?? "",
  };

  const parsed = createProjectSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((e: { message: string }) => e.message).join(", ");
    return { error: `Validation error: ${msg}` };
  }

  const { customer_id, name, slug, photography_type, gallery_pin, shoot_date } =
    parsed.data;

  const pepper = getPinPepper();
  const [gallery_code, access_token, gallery_pin_hash] = await Promise.all([
    Promise.resolve(generateGalleryCode()),
    Promise.resolve(generateAccessToken()),
    hashGalleryPin(gallery_pin, pepper),
  ]);

  const { error } = await supabase.from("projects").insert({
    customer_id,
    name,
    slug,
    photography_type,
    gallery_code,
    gallery_pin_hash,
    access_token,
    shoot_date: shoot_date || null,
    status: "draft",
  });

  if (error) {
    return { error: `Failed to create project: ${error.message}` };
  }

  redirect("/admin/projects");
}

/**
 * Step 1: Creates an initial project draft with sector specs pre-populated.
 * Autosaves immediately upon proceeding from Step 1.
 */
export async function createProjectDraftAction(data: {
  customer_id: string;
  name: string;
  slug?: string;
  service_pillar: string;
}): Promise<{ success: boolean; project?: ProjectRow; error?: string }> {
  try {
    const { supabase } = await requireOps();
    const { customer_id, name, service_pillar } = data;

    if (!customer_id || !name.trim()) {
      return { success: false, error: "Pilih klien dan masukkan nama proyek." };
    }

    const baseSlug = (data.slug?.trim() || name.trim())
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    const slug = `${baseSlug || "proyek"}-${Date.now().toString(36).slice(-4)}`;
    const pepper = getPinPepper();
    // Auto-generate gallery code, 43-char access token, and default PIN (123456)
    const gallery_code = generateGalleryCode();
    const access_token = generateAccessToken();
    const defaultPin = Math.floor(100000 + Math.random() * 900000).toString();
    const gallery_pin_hash = await hashGalleryPin(defaultPin, pepper);

    // Determine photography type fallback
    const photography_type = service_pillar.includes("PHOTO")
      ? "graduation"
      : service_pillar.includes("BROADCAST")
      ? "event"
      : "event";

    const { data: project, error } = await supabase
      .from("projects")
      .insert({
        customer_id,
        name: name.trim(),
        slug,
        service_pillar,
        photography_type,
        gallery_code,
        gallery_pin_hash,
        access_token,
        status: "draft",
      })
      .select()
      .single();

    if (error) {
      return { success: false, error: `Gagal membuat draft: ${error.message}` };
    }

    return { success: true, project };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Gagal membuat draft proyek";
    return { success: false, error: message };
  }
}

/**
 * Step 2 & 3: Updates intermediate staging and commercial data on the draft project.
 */
export async function updateProjectWizardStepAction(
  projectId: string,
  stepData: {
    shoot_date?: string | null;
    rehearsal_date?: string | null;
    contract_value?: number;
    dp_amount?: number;
    sector_specs?: Record<string, unknown>;
    notes?: string;
    venue_name?: string;
    venue_address?: string;
    venue_maps_url?: string;
    roll_time?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase } = await requireOps();

    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (stepData.shoot_date !== undefined) updatePayload.shoot_date = stepData.shoot_date || null;
    if (stepData.rehearsal_date !== undefined) updatePayload.rehearsal_date = stepData.rehearsal_date || null;
    if (stepData.contract_value !== undefined) updatePayload.contract_value = Number(stepData.contract_value) || 0;
    if (stepData.dp_amount !== undefined) updatePayload.dp_amount = Number(stepData.dp_amount) || 0;
    if (stepData.sector_specs !== undefined) updatePayload.sector_specs = stepData.sector_specs;

    const { error } = await supabase
      .from("projects")
      .update(updatePayload)
      .eq("id", projectId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Gagal memperbarui data proyek";
    return { success: false, error: message };
  }
}

/**
 * Finalizes the wizard scaffold: transitions project to 'ready' and generates initial invoices.
 */
export async function completeProjectScaffoldAction(
  projectId: string
): Promise<{ success: boolean; redirectUrl?: string; error?: string }> {
  try {
    const { supabase } = await requireOps();

    const { data: project, error: fetchErr } = await supabase
      .from("projects")
      .select("id, contract_value, dp_amount")
      .eq("id", projectId)
      .single();

    if (fetchErr || !project) {
      return { success: false, error: "Proyek tidak ditemukan" };
    }

    // Transition status to ready
    const { error: updateErr } = await supabase
      .from("projects")
      .update({ status: "ready", updated_at: new Date().toISOString() })
      .eq("id", projectId);

    if (updateErr) {
      return { success: false, error: updateErr.message };
    }

    // Auto-generate milestone invoices if contract_value is provided
    const contractVal = Number(project.contract_value) || 0;
    if (contractVal > 0) {
      const dpVal = Number(project.dp_amount) || Math.round(contractVal * 0.5);
      const finalVal = contractVal - dpVal;

      // Generate DP invoice
      await supabase.from("invoices").insert([
        {
          project_id: projectId,
          invoice_number: `INV-${Date.now().toString().slice(-6)}-DP`,
          milestone: "DP_50",
          amount: dpVal,
          status: "PENDING",
          pdf_url: null,
        },
        {
          project_id: projectId,
          invoice_number: `INV-${Date.now().toString().slice(-6)}-FIN`,
          milestone: "FINAL_BALANCE",
          amount: finalVal,
          status: "DRAFT",
          pdf_url: null,
        },
      ]);
    }

    return { success: true, redirectUrl: `/admin/projects/${projectId}` };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Gagal menyelesaikan pembuatan proyek";
    return { success: false, error: message };
  }
}

/**
 * Tab 1: Updates project core overview fields, venue, rehearsal staging, and status.
 * Safely cascades date changes through trg_cascade_project_reschedule.
 */
export async function updateProjectOverviewAction(
  projectId: string,
  input: {
    name?: string;
    shoot_date?: string | null;
    rehearsal_date?: string | null;
    status?: ProjectStatus;
    customer_id?: string;
    customer_name?: string;
    customer_phone?: string;
    customer_email?: string;
    venue_name?: string;
    venue_address?: string;
    venue_maps_url?: string;
    roll_time?: string;
    rehearsal_call_time?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase } = await requireOps();

    if (!uuidSchema.safeParse(projectId).success) {
      return { success: false, error: "ID proyek tidak valid." };
    }

    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (input.name && input.name.trim().length >= 2) {
      updatePayload.name = input.name.trim();
    }

    if (input.shoot_date !== undefined) {
      updatePayload.shoot_date = input.shoot_date || null;
    }

    if (input.rehearsal_date !== undefined) {
      updatePayload.rehearsal_date = input.rehearsal_date || null;
    }

    if (input.status) {
      updatePayload.status = input.status;
    }

    // Merge venue & staging into sector_specs if present
    if (input.venue_name || input.venue_address || input.venue_maps_url || input.roll_time || input.rehearsal_call_time) {
      const { data: currentProject } = await supabase
        .from("projects")
        .select("sector_specs")
        .eq("id", projectId)
        .maybeSingle();

      const existingSpecs = (currentProject?.sector_specs as Record<string, unknown>) || {};
      const stagingSpecs = {
        ...existingSpecs,
        venueName: input.venue_name || existingSpecs.venueName,
        venueAddress: input.venue_address || existingSpecs.venueAddress,
        venueMapsUrl: input.venue_maps_url || existingSpecs.venueMapsUrl,
        rollTime: input.roll_time || existingSpecs.rollTime,
        rehearsalCallTime: input.rehearsal_call_time || existingSpecs.rehearsalCallTime,
      };
      updatePayload.sector_specs = stagingSpecs;
    }

    // Execute project update
    const { error: projectError } = await supabase
      .from("projects")
      .update(updatePayload)
      .eq("id", projectId);

    if (projectError) {
      return { success: false, error: projectError.message };
    }

    // Update customer details if supplied
    if (input.customer_id && (input.customer_name || input.customer_phone || input.customer_email)) {
      const customerUpdate: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (input.customer_name?.trim()) customerUpdate.name = input.customer_name.trim();
      if (input.customer_phone !== undefined) customerUpdate.phone = input.customer_phone.trim();
      if (input.customer_email !== undefined) customerUpdate.email = input.customer_email.trim() || null;

      await supabase
        .from("customers")
        .update(customerUpdate)
        .eq("id", input.customer_id);
    }

    revalidatePath(`/admin/projects/${projectId}`);
    revalidatePath("/admin/projects");
    revalidatePath("/admin/calendar");
    revalidatePath("/admin");

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Gagal memperbarui data proyek";
    return { success: false, error: message };
  }
}
