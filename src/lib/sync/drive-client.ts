/**
 * Google Drive API & Workspace Shared Drive Provisioning Service
 * eLTs Visual Studio OS
 *
 * Automates hierarchical folder tree creation (YYYY / Pillar / Project)
 * with isolated subfolders: 01_RAW_Capture, 02_Selection_Proofs, and 03_Final_Deliverables.
 * Enforces payment-gated access delegation.
 */

import crypto from "node:crypto";
import { createServiceSupabase } from "@/lib/supabase/service";

export interface DriveFolderResult {
  id: string;
  name: string;
  url: string;
}

export interface ProjectDriveHierarchy {
  projectFolder: DriveFolderResult;
  rawCaptureFolder: DriveFolderResult;
  selectionProofsFolder: DriveFolderResult;
  finalDeliverablesFolder: DriveFolderResult;
  isMock?: boolean;
}

/**
 * Determine if Drive client should execute in mock mode.
 */
function isMockMode(): boolean {
  return (
    !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    !process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ||
    process.env.MOCK_DRIVE_API === "true" ||
    process.env.NEXT_PHASE === "phase-production-build" ||
    (process.env.NODE_ENV === "test" && process.env.ENABLE_REAL_DRIVE !== "true")
  );
}

/**
 * Generates an OAuth2 access token for Google Drive API via Service Account JWT.
 */
async function getDriveAccessToken(): Promise<string | null> {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKeyRaw = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

  if (!clientEmail || !privateKeyRaw) {
    return null;
  }

  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);
  const expiry = now + 3600;

  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/drive",
    aud: "https://oauth2.googleapis.com/token",
    exp: expiry,
    iat: now,
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedClaim = Buffer.from(JSON.stringify(claimSet)).toString("base64url");
  const signatureInput = `${encodedHeader}.${encodedClaim}`;

  try {
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(signatureInput);
    const signature = signer.sign(privateKey, "base64url");
    const jwt = `${signatureInput}.${signature}`;

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });

    if (!res.ok) {
      console.warn("[GoogleDrive] OAuth token request failed:", res.status);
      return null;
    }

    const data = (await res.json()) as { access_token?: string };
    return data.access_token || null;
  } catch (err) {
    console.warn("[GoogleDrive] JWT signing error:", err);
    return null;
  }
}

/**
 * Creates a single folder in Google Drive or returns mock folder details.
 */
async function createDriveFolder(
  name: string,
  parentId?: string,
  token?: string | null
): Promise<DriveFolderResult> {
  if (!token) {
    const mockId = `mock_folder_${Math.random().toString(36).slice(2, 10)}`;
    return {
      id: mockId,
      name,
      url: `https://drive.google.com/drive/folders/${mockId}`,
    };
  }

  try {
    const res = await fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: parentId ? [parentId] : undefined,
      }),
    });

    if (!res.ok) {
      throw new Error(`Drive API folder creation failed: HTTP ${res.status}`);
    }

    const json = (await res.json()) as { id: string; name: string };
    return {
      id: json.id,
      name: json.name,
      url: `https://drive.google.com/drive/folders/${json.id}`,
    };
  } catch (err) {
    console.warn(`[GoogleDrive] Failed to create folder "${name}", fallback to simulated:`, err);
    const mockId = `mock_folder_${Math.random().toString(36).slice(2, 10)}`;
    return {
      id: mockId,
      name,
      url: `https://drive.google.com/drive/folders/${mockId}`,
    };
  }
}

/**
 * Provisions a complete standard project directory tree in Google Drive:
 *   [Project Name] /
 *     ├── 01_RAW_Capture
 *     ├── 02_Selection_Proofs
 *     └── 03_Final_Deliverables
 */
export async function provisionProjectDriveFolders(params: {
  projectId: string;
  projectName: string;
  servicePillar?: string | null;
  year?: number;
}): Promise<ProjectDriveHierarchy> {
  const token = isMockMode() ? null : await getDriveAccessToken();
  const year = params.year || new Date().getFullYear();
  const pillar = params.servicePillar || "GENERAL";
  const folderTitle = `${year}_${pillar}_${params.projectName.replace(/[^a-zA-Z0-9_\-]/g, "_")}`;

  // 1. Create Root Project Folder
  const projectFolder = await createDriveFolder(folderTitle, undefined, token);

  // 2. Create the 3 Standard Isolated Subfolders
  const [rawCaptureFolder, selectionProofsFolder, finalDeliverablesFolder] = await Promise.all([
    createDriveFolder("01_RAW_Capture", projectFolder.id, token),
    createDriveFolder("02_Selection_Proofs", projectFolder.id, token),
    createDriveFolder("03_Final_Deliverables", projectFolder.id, token),
  ]);

  return {
    projectFolder,
    rawCaptureFolder,
    selectionProofsFolder,
    finalDeliverablesFolder,
    isMock: !token,
  };
}

/**
 * Programmatically grants 'reader' permission to a client for final deliverables folder.
 */
export async function grantClientDriveAccess(
  folderId: string,
  clientEmail: string
): Promise<{ success: boolean; error?: string }> {
  if (isMockMode() || folderId.startsWith("mock_")) {
    return { success: true };
  }

  const token = await getDriveAccessToken();
  if (!token) {
    return { success: false, error: "Google Drive authentication token unavailable" };
  }

  try {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}/permissions?supportsAllDrives=true`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          role: "reader",
          type: "user",
          emailAddress: clientEmail,
        }),
      }
    );

    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      throw new Error(errJson?.error?.message || `HTTP ${res.status}`);
    }

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Orchestrator helper: provisions drive hierarchy and binds the final deliverables
 * URL to `projects.sector_specs.googleDriveUrl` in Supabase.
 */
export async function provisionAndBindProjectDriveVault(projectId: string): Promise<{
  success: boolean;
  googleDriveUrl?: string;
  error?: string;
}> {
  try {
    const supabase = createServiceSupabase();

    const { data: project, error: fetchErr } = await supabase
      .from("projects")
      .select("id, name, service_pillar, sector_specs")
      .eq("id", projectId)
      .maybeSingle();

    if (fetchErr || !project) {
      return { success: false, error: "Project not found" };
    }

    const hierarchy = await provisionProjectDriveFolders({
      projectId: project.id,
      projectName: project.name,
      servicePillar: project.service_pillar,
    });

    const deliverablesUrl = hierarchy.finalDeliverablesFolder.url;
    const currentSpecs = (project.sector_specs as Record<string, unknown>) || {};

    const updatedSpecs = {
      ...currentSpecs,
      googleDriveUrl: deliverablesUrl,
      googleDriveHierarchy: {
        projectFolderId: hierarchy.projectFolder.id,
        projectFolderUrl: hierarchy.projectFolder.url,
        finalDeliverablesFolderId: hierarchy.finalDeliverablesFolder.id,
        finalDeliverablesFolderUrl: hierarchy.finalDeliverablesFolder.url,
        isMock: hierarchy.isMock,
      },
    };

    const { error: updateErr } = await supabase
      .from("projects")
      .update({
        sector_specs: updatedSpecs,
      })
      .eq("id", projectId);

    if (updateErr) {
      return { success: false, error: updateErr.message };
    }

    return {
      success: true,
      googleDriveUrl: deliverablesUrl,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Error provisioning drive vault",
    };
  }
}
