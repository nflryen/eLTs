import "server-only";
import type { ProjectStatus } from "@/types/database";

export interface GallerySessionPolicy {
  projectId: string;
  galleryAccess: boolean;
  expiresAt: Date;
  revokedAt: Date | null;
}
export interface GalleryProjectPolicy {
  id: string;
  status: ProjectStatus;
  expiresAt: Date | null;
  allowDownload: boolean;
}

/** Fail closed. The caller must load both records from trusted server storage. */
export function canAccessGallery(
  session: GallerySessionPolicy,
  project: GalleryProjectPolicy,
  now = new Date(),
): boolean {
  return (
    session.projectId === project.id &&
    session.galleryAccess &&
    session.revokedAt === null &&
    session.expiresAt.getTime() > now.getTime() &&
    project.status === "ready" &&
    (project.expiresAt === null || project.expiresAt.getTime() > now.getTime())
  );
}

export function canAccessMedia(
  session: GallerySessionPolicy,
  project: GalleryProjectPolicy,
  mediaProjectId: string,
  intent: "preview" | "download",
  now = new Date(),
) {
  return (
    mediaProjectId === project.id &&
    canAccessGallery(session, project, now) &&
    (intent !== "download" || project.allowDownload)
  );
}
