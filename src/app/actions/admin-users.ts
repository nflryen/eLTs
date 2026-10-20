"use server";

import { requireOps } from "@/lib/auth/roles";
import { hashGalleryPin } from "@/lib/security/credentials";
import { getPinPepper } from "@/lib/env";
import { revalidatePath } from "next/cache";
import type {
  ProjectRow,
  CustomerRow,
  AdminRow,
  EditorTaskRow,
} from "@/types/database";
import type { CrewMemberRow, CrewIdentityRow } from "@/types/operations";
import type { UserProfileRow } from "@/types/database";

import type {
  UserRole,
  UserStatus,
  UnifiedUser,
} from "@/types/users";

/**
 * Normalizes phone numbers and generates direct WhatsApp API links.
 */
export async function formatWhatsAppLink(
  phone: string | null | undefined,
  text?: string
): Promise<string> {
  if (!phone) return "";
  let digits = phone.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) {
    digits = "62" + digits.slice(1);
  } else if (!digits.startsWith("62")) {
    digits = "62" + digits;
  }
  const query = text ? `?text=${encodeURIComponent(text)}` : "";
  return `https://wa.me/${digits}${query}`;
}

/**
 * Aggregates records across Studio Owners, Freelancers, Post-Production Editors, and Clients
 * into a single unified user directory.
 */
export async function getUnifiedUsersList(): Promise<UnifiedUser[]> {
  const { supabase } = await requireOps();

  const results: UnifiedUser[] = [];

  // =========================================================================
  // a) Studio Owners: queries public.admins & auth.users (Role: 'OWNER')
  // =========================================================================
  try {
    const { data: adminsData, error: adminsError } = await supabase
      .from("admins")
      .select("user_id, display_name, created_at");

    if (adminsError) {
      console.error("Error fetching admins:", adminsError);
    }

    const authUsersMap = new Map<
      string,
      {
        email?: string;
        phone?: string;
        last_sign_in_at?: string;
        confirmed_at?: string;
      }
    >();

    try {
      const { data: authData } = await supabase.auth.admin.listUsers();
      if (authData?.users) {
        for (const u of authData.users) {
          authUsersMap.set(u.id, {
            email: u.email,
            phone: u.phone || (u.user_metadata?.phone as string | undefined),
            last_sign_in_at: u.last_sign_in_at,
            confirmed_at: u.confirmed_at,
          });
        }
      }
    } catch (authErr) {
      console.warn("Could not list auth users from admin API:", authErr);
    }

    for (const admin of (adminsData || []) as AdminRow[]) {
      const authUser = authUsersMap.get(admin.user_id);
      const email = authUser?.email || "admin@elts.studio";
      const phone = authUser?.phone || "082234590719";
      const lastActive = authUser?.last_sign_in_at || admin.created_at || null;
      const waLink = await formatWhatsAppLink(
        phone,
        `Halo ${admin.display_name} (ELTs Admin)`
      );

      results.push({
        id: admin.user_id,
        name: admin.display_name || "Studio Owner",
        role: "OWNER",
        email,
        phone,
        details: "👑 Studio Co-Founder & System Administrator",
        status: "ACTIVE",
        lastActive,
        waLink,
        metadata: {
          userId: admin.user_id,
          displayName: admin.display_name,
          createdAt: admin.created_at,
          lastSignIn: authUser?.last_sign_in_at || null,
        },
      });
    }
  } catch (err) {
    console.error("Failed aggregating owners:", err);
  }

  // =========================================================================
  // b & c) Freelancers & Editors: queries public.crew_members & public.editor_tasks
  // =========================================================================
  try {
    const [crewRes, editorTasksRes] = await Promise.all([
      /*
       * Read through `v_crew_identity`, not `crew_members`.
       *
       * Migration 0024 removed phone/email/bank_* from crew_members; the view
       * resolves them from user_profiles (linked crew) or crew_contact_details
       * (unlinked). Querying crew_members directly would silently lose the
       * operator's ability to see a freelancer's contact details.
       */
      supabase
        .from("v_crew_identity")
        .select("*")
        .order("crew_code", { ascending: true }),
      supabase
        .from("editor_tasks")
        .select(
          "id, project_id, assigned_editor_id, status, deliverable_count, notes, created_at"
        ),
    ]);

    const crewList = (crewRes.data || []) as CrewIdentityRow[];
    const editorTasks = (editorTasksRes.data || []) as EditorTaskRow[];

    const assignedEditorIds = new Set<string>();
    const editorTaskCountByCrewId = new Map<string, number>();

    for (const t of editorTasks) {
      if (t.assigned_editor_id) {
        assignedEditorIds.add(t.assigned_editor_id);
        editorTaskCountByCrewId.set(
          t.assigned_editor_id,
          (editorTaskCountByCrewId.get(t.assigned_editor_id) || 0) + 1
        );
      }
    }

    for (const crew of crewList) {
      const skills = Array.isArray((crew.primary_skills ?? []))
        ? (crew.primary_skills ?? [])
        : [];
      const hasEditorSkill = skills.some((s: string) =>
        /editor|editing|lightroom|retouch|grading|post/i.test(s)
      );
      const isRoleEditor = crew.role_category === "EDITOR";
      const isAssignedEditor = assignedEditorIds.has(crew.crew_member_id);

      const isEditor = isRoleEditor || hasEditorSkill || isAssignedEditor;
      const role: UserRole = isEditor ? "EDITOR" : "FREELANCE";
      const status: UserStatus = crew.is_active ? "ACTIVE" : "SUSPENDED";
      const taskCount = editorTaskCountByCrewId.get(crew.crew_member_id) || 0;

      let details = "";
      if (isEditor) {
        const skillStr =
          skills.length > 0 ? skills.join(", ") : "Lightroom & Curation";
        details = `${crew.crew_code} • Post-Production Editor • ${
          taskCount > 0 ? `${taskCount} task aktif • ` : ""
        }${skillStr}`;
      } else {
        const skillStr =
          skills.length > 0 ? skills.join(", ") : "Crew Operasional";
        details = `${crew.crew_code} • ${
          crew.role_category || "Technician"
        } • ${skillStr}`;
      }

      const waLink = await formatWhatsAppLink(
        crew.phone ?? "",
        `Halo kak ${crew.full_name} (${crew.crew_code}) - Operasional ELTs. Studio`
      );

      results.push({
        id: crew.crew_member_id,
        name: crew.full_name,
        role,
        email: "",
        phone: crew.phone || "",
        details,
        status,
        lastActive: null,
        waLink,
        metadata: {
          crewCode: crew.crew_code,
          roleCategory: crew.role_category ?? undefined,
          primarySkills: skills,
          standardDayRate: Number(crew.standard_day_rate || 0),
          rating: Number(crew.rating || 5.0),
          bankName: crew.bank_name ?? "",
          bankAccountNumber: crew.bank_account_number ?? "",
          bankAccountHolder: crew.bank_account_holder ?? "",
          isActive: crew.is_active,
          assignedTasksCount: taskCount,
          emergencyContact: undefined,
        },
      });
    }
  } catch (err) {
    console.error("Failed aggregating crew and editors:", err);
  }

  // =========================================================================
  // d) Clients: queries public.customers and linked active projects
  // =========================================================================
  try {
    const [customersRes, projectsRes] = await Promise.all([
      supabase
        .from("customers")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase
        .from("projects")
        .select(
          "id, customer_id, name, slug, gallery_code, access_token, photography_type, status, shoot_date, selection_quota_max, selection_locked_at, created_at, updated_at"
        )
        .order("created_at", { ascending: false }),
    ]);

    const customers = (customersRes.data || []) as CustomerRow[];
    const projects = (projectsRes.data || []) as ProjectRow[];

    const projectsByCustomer = new Map<string, ProjectRow[]>();
    for (const proj of projects) {
      const list = projectsByCustomer.get(proj.customer_id) || [];
      list.push(proj);
      projectsByCustomer.set(proj.customer_id, list);
    }

    for (const cust of customers) {
      const custProjects = projectsByCustomer.get(cust.id) || [];

      let status: UserStatus = "ACTIVE";
      if (cust.archived_at) {
        status = "SUSPENDED";
      } else if (custProjects.some((p) => p.status === "ready")) {
        status = "READY";
      } else {
        status = "ACTIVE";
      }

      let details = "";
      if (custProjects.length > 0) {
        const topProjects = custProjects
          .slice(0, 2)
          .map((p) => p.name)
          .join(", ");
        const more =
          custProjects.length > 2 ? ` (+${custProjects.length - 2} lagi)` : "";
        details = `${custProjects.length} Proyek: ${topProjects}${more}`;
      } else {
        details = "Klien terdaftar • Belum ada proyek aktif";
      }

      const lastActive =
        custProjects[0]?.updated_at ||
        custProjects[0]?.created_at ||
        cust.updated_at ||
        cust.created_at ||
        null;

      const waLink = await formatWhatsAppLink(
        cust.phone,
        `Halo kak ${cust.name}, salam dari tim ELTs. Photography!`
      );

      results.push({
        id: cust.id,
        name: cust.name,
        role: "CLIENT",
        email: cust.email || "",
        phone: cust.phone || "",
        details,
        status,
        lastActive,
        waLink,
        metadata: {
          customerId: cust.id,
          archivedAt: cust.archived_at,
          projectsCount: custProjects.length,
          projects: custProjects.map((p) => ({
            id: p.id,
            name: p.name,
            slug: p.slug,
            galleryCode: p.gallery_code,
            accessToken: p.access_token,
            photographyType: p.photography_type,
            status: p.status,
            shootDate: p.shoot_date,
            selectionLockedAt: p.selection_locked_at,
          })),
        },
      });
    }
  } catch (err) {
    console.error("Failed aggregating clients:", err);
  }

  return results;
}

/**
 * Toggles a user's status between ACTIVE, SUSPENDED, and READY.
 */
export async function toggleUserStatus(
  userId: string,
  role: UserRole,
  newStatus: UserStatus
): Promise<{ success: boolean; error?: string; message?: string }> {
  try {
    const { supabase } = await requireOps();

    if (role === "OWNER") {
      return {
        success: true,
        message: "Status akun Studio Owner tetap aktif dan dilindungi.",
      };
    }

    if (role === "FREELANCE" || role === "EDITOR") {
      const isActive = newStatus !== "SUSPENDED";
      const { error } = await supabase
        .from("crew_members")
        .update({
          is_active: isActive,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId);

      if (error) {
        return { success: false, error: error.message };
      }

      revalidatePath("/admin/users");
      return { success: true, message: `Status crew diubah ke ${newStatus}.` };
    }

    if (role === "CLIENT") {
      const archivedAt =
        newStatus === "SUSPENDED" ? new Date().toISOString() : null;
      const { error } = await supabase
        .from("customers")
        .update({
          archived_at: archivedAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId);

      if (error) {
        return { success: false, error: error.message };
      }

      revalidatePath("/admin/users");
      return { success: true, message: `Status klien diubah ke ${newStatus}.` };
    }

    return { success: false, error: "Role pengguna tidak dikenal." };
  } catch (err: unknown) {
    const errorMessage =
      err instanceof Error ? err.message : "Gagal memperbarui status pengguna.";
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Hashes new PIN with scrypt-v2 and updates public.projects.gallery_pin_hash.
 */
export async function resetClientPin(
  projectId: string,
  newPin: string
): Promise<{ success: boolean; error?: string; newPin?: string; hash?: string }> {
  try {
    const { supabase } = await requireOps();

    const cleanPin = newPin.trim();
    if (!/^\d{4,12}$/.test(cleanPin)) {
      return {
        success: false,
        error: "PIN galeri harus berupa 4 hingga 12 digit angka.",
      };
    }

    const pepper = getPinPepper();
    const pinHash = await hashGalleryPin(cleanPin, pepper);

    const { error } = await supabase
      .from("projects")
      .update({
        gallery_pin_hash: pinHash,
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId);

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath("/admin/users");
    revalidatePath(`/admin/projects/${projectId}`);
    return {
      success: true,
      newPin: cleanPin,
      hash: pinHash,
    };
  } catch (err: unknown) {
    const errorMessage =
      err instanceof Error ? err.message : "Gagal mereset PIN galeri klien.";
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Generates a random 6-digit numeric PIN for quick reset.
 */
export async function generateRandomPinAction(): Promise<string> {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Updates a crew member's profile: phone, skills, day rate, bank details, emergency contact.
 */
export async function updateCrewMemberProfileAction(
  crewId: string,
  data: {
    full_name?: string;
    phone?: string;
    email?: string | null;
    primary_skills?: string[];
    standard_day_rate?: number;
    bank_name?: string;
    bank_account_number?: string;
    bank_account_holder?: string;
    emergency_contact?: string | null;
    role_category?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase } = await requireOps();

    /*
     * ASSIGNMENT facts go to crew_members; PERSON facts go elsewhere.
     *
     * Migration 0024 removed phone/email/bank_* from crew_members. Writing them
     * back there would silently fail, so the payload is split by destination:
     *
     *   crew_members              -> full_name, skills, day rate, category…
     *   user_profiles             -> phone/email/bank, WHEN the crew has a login
     *   crew_contact_details      -> the same, when they do NOT
     *
     * The split is resolved from `auth_user_id`, so an operator editing a
     * freelancer without an account still lands the data somewhere durable.
     */
    const updatePayload: Partial<CrewMemberRow> = {
      updated_at: new Date().toISOString(),
    };

    if (data.full_name?.trim()) updatePayload.full_name = data.full_name.trim();
    if (data.primary_skills) updatePayload.primary_skills = data.primary_skills;
    if (data.standard_day_rate !== undefined) updatePayload.standard_day_rate = Number(data.standard_day_rate);
    if (data.emergency_contact !== undefined) updatePayload.emergency_contact = data.emergency_contact?.trim() || null;
    if (data.role_category) updatePayload.role_category = data.role_category;

    /* Resolve which contact store this crew member belongs to. */
    const { data: crewRow } = await supabase
      .from("crew_members")
      .select("auth_user_id")
      .eq("id", crewId)
      .maybeSingle();

    const linkedUserId = (crewRow as { auth_user_id: string | null } | null)?.auth_user_id ?? null;

    const wantsContactWrite =
      data.phone !== undefined ||
      data.email !== undefined ||
      data.bank_name !== undefined ||
      data.bank_account_number !== undefined ||
      data.bank_account_holder !== undefined;

    if (wantsContactWrite) {
      if (linkedUserId) {
        const profilePatch: Partial<Pick<
          UserProfileRow,
          "phone" | "bank_name" | "bank_account_number" | "bank_account_holder"
        >> = {};
        if (data.phone !== undefined) profilePatch.phone = data.phone?.trim() || null;
        if (data.bank_name !== undefined) profilePatch.bank_name = data.bank_name?.trim() || null;
        if (data.bank_account_number !== undefined)
          profilePatch.bank_account_number = data.bank_account_number?.trim() || null;
        if (data.bank_account_holder !== undefined)
          profilePatch.bank_account_holder = data.bank_account_holder?.trim() || null;

        if (Object.keys(profilePatch).length > 0) {
          const { error: profileError } = await supabase
            .from("user_profiles")
            .update(profilePatch)
            .eq("user_id", linkedUserId);
          if (profileError) return { success: false, error: profileError.message };
        }
      } else {
        const contactPatch: Record<string, string | null> = {};
        if (data.phone !== undefined) contactPatch.phone = data.phone?.trim() || null;
        if (data.email !== undefined) contactPatch.email = data.email?.trim() || null;
        if (data.bank_name !== undefined) contactPatch.bank_name = data.bank_name?.trim() || null;
        if (data.bank_account_number !== undefined)
          contactPatch.bank_account_number = data.bank_account_number?.trim() || null;
        if (data.bank_account_holder !== undefined)
          contactPatch.bank_account_holder = data.bank_account_holder?.trim() || null;

        if (Object.keys(contactPatch).length > 0) {
          const { error: contactError } = await supabase
            .from("crew_contact_details")
            .upsert({ crew_member_id: crewId, ...contactPatch }, { onConflict: "crew_member_id" });
          if (contactError) return { success: false, error: contactError.message };
        }
      }
    }

    const { error } = await supabase
      .from("crew_members")
      .update(updatePayload)
      .eq("id", crewId);

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath("/admin/users");
    revalidatePath("/admin/calendar");

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Gagal memperbarui profil kru";
    return { success: false, error: message };
  }
}
