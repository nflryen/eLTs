import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Camera, CalendarDays, LockKeyhole, Images, Sparkles } from "lucide-react";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getGallerySession } from "@/lib/auth/gallery";
import { mediaGatewayUrl } from "@/lib/media/gateway-url";
import { GalleryGrid, type GalleryMediaItem } from "@/components/client/gallery-grid";
import { getSessionFavorites } from "@/app/actions/client-gallery";
import type { ProjectRow } from "@/types/database";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return {
    title: "Your Gallery — Elts.",
    robots: { index: false, follow: false },
  };
}

export default async function GalleryPage({ params }: Props) {
  const { slug } = await params;

  // ── Session validation & Direct Token Access ──────────────────────────────
  let gallerySession = await getGallerySession().catch(() => null);
  const supabase = createServiceSupabase();

  if (!gallerySession) {
    // Check if the URL slug directly matches a ready project's access_token or slug
    const { data: directProject } = await supabase
      .from("projects")
      .select("id, name, slug, access_token, gallery_pin_hash, status, expires_at")
      .or(`access_token.eq.${slug},slug.eq.${slug}`)
      .eq("status", "ready")
      .maybeSingle();

    if (directProject && (!directProject.expires_at || new Date(directProject.expires_at) > new Date())) {
      // Direct token access / development session bypass without calling cookie.set in Server Component
      gallerySession = {
        session_id: "direct-session",
        project_id: directProject.id,
        access_token: directProject.access_token,
        slug: directProject.slug,
        expires_at: directProject.expires_at ?? new Date(Date.now() + 86400000).toISOString(),
      };
    }
  }

  if (!gallerySession) {
    redirect(`/client?from=/gallery/${slug}`);
  }

  // ── Load project with defensive fallback ──────────────────────────────────
  let projectData: Partial<ProjectRow> | null = null;
  const { data: fullData } = await supabase
    .from("projects")
    .select(
      "id, name, slug, access_token, photography_type, shoot_date, status, allow_download, watermark_enabled, expires_at, cover_media_id, selection_quota_min, selection_quota_max, selection_locked_at",
    )
    .eq("id", gallerySession.project_id)
    .maybeSingle();

  if (fullData) {
    projectData = fullData as Partial<ProjectRow>;
  } else {
    // Fallback to base columns if newly added columns have not been migrated on remote database
    const { data: baseData } = await supabase
      .from("projects")
      .select(
        "id, name, slug, access_token, photography_type, shoot_date, status, allow_download, watermark_enabled, expires_at, cover_media_id",
      )
      .eq("id", gallerySession.project_id)
      .maybeSingle();

    if (baseData) {
      projectData = {
        ...baseData,
        selection_quota_min: 15,
        selection_quota_max: 20,
        selection_locked_at: null,
      } as Partial<ProjectRow>;
    }
  }

  if (!projectData) {
    return <GalleryUnavailable message="This gallery does not exist." />;
  }

  const project = projectData as Pick<
    ProjectRow,
    | "id" | "name" | "slug" | "access_token" | "photography_type" | "shoot_date"
    | "status" | "allow_download" | "watermark_enabled" | "expires_at" | "cover_media_id"
    | "selection_quota_min" | "selection_quota_max" | "selection_locked_at"
  >;

  if (project.access_token !== slug && project.slug !== slug) {
    return <GalleryUnavailable message="This gallery link is no longer available." />;
  }

  // ── Availability checks ──────────────────────────────────────────────────
  if (project.status !== "ready") {
    return (
      <GalleryUnavailable message="This gallery is not yet available. Please check back later." />
    );
  }

  if (project.expires_at && new Date(project.expires_at) < new Date()) {
    return (
      <GalleryUnavailable message="This gallery is no longer available. Please contact Elts. for access." />
    );
  }

  // ── Load media ───────────────────────────────────────────────────────────
  //
  // Watermark selection is NOT decided here. The gateway resolves the correct
  // variant from the project flag at request time, so a watermarked project can
  // never be served a plain preview by a stale client decision.
  const { data: mediaData, count } = await supabase
    .from("media")
    .select("id, type, file_name, width, height", { count: "exact" })
    .eq("project_id", project.id)
    .eq("processing_status", "ready")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  // Storage keys are intentionally never placed in this payload. The client
  // receives only a same-origin gateway path, so recognising a media id or
  // copying a URL cannot bypass the session check.
  const media: GalleryMediaItem[] = (mediaData ?? []).map((m) => ({
    id: m.id as string,
    type: m.type as "image" | "video",
    file_name: m.file_name as string,
    width: (m.width as number | null) ?? null,
    height: (m.height as number | null) ?? null,
    thumbnail_key: mediaGatewayUrl(m.id as string, "thumbnail"),
    preview_key: mediaGatewayUrl(m.id as string, "preview"),
  }));

  const totalCount = count ?? 0;
  const photoCount = media.filter((m) => m.type === "image").length;
  const videoCount = media.filter((m) => m.type === "video").length;

  // ── Load favorites for initial hydration ─────────────────────────────────
  const favoritedIds = await getSessionFavorites(project.id);

  // ── Cover photo ──────────────────────────────────────────────────────────
  const coverItem = media.find((m) => m.id === project.cover_media_id) ?? media[0];

  const shootDate = project.shoot_date
    ? new Date(project.shoot_date).toLocaleDateString("id-ID", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <main id="main-content" className="min-h-svh bg-[#F7F7F5]">
      {/* ── Hero / Cover ─────────────────────────────────────────────────── */}
      <div className="relative h-[55vh] min-h-[360px] overflow-hidden bg-zinc-900">
        {coverItem?.thumbnail_key && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverItem.preview_key ?? coverItem.thumbnail_key}
            alt={project.name}
            className="absolute inset-0 w-full h-full object-cover opacity-70"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/60" />

        {/* Nav */}
        <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-6 py-5">
          <Link href="/" className="wordmark text-white">
            Elts.
          </Link>
          <div className="flex items-center gap-1.5 text-white/70 text-xs">
            <LockKeyhole size={13} />
            <span>Private Gallery</span>
          </div>
        </div>

        {/* Project info overlay */}
        <div className="absolute bottom-0 left-0 right-0 px-6 py-8 text-white">
          <p className="text-xs uppercase tracking-widest text-white/60 mb-2 capitalize">
            {project.photography_type}
          </p>
          <h1 className="font-serif text-4xl sm:text-5xl font-bold leading-tight">
            {project.name}
          </h1>
          {shootDate && (
            <p className="mt-2 text-white/70 text-sm flex items-center gap-1.5">
              <CalendarDays size={14} />
              {shootDate}
            </p>
          )}
        </div>
      </div>

      {/* ── Stats bar ────────────────────────────────────────────────────── */}
      <div className="border-b border-border bg-white">
        <div className="max-w-6xl mx-auto px-5 py-4 flex flex-wrap items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-6">
            <span className="flex items-center gap-1.5">
              <Images size={15} />
              <strong className="text-foreground">{photoCount}</strong> Photos
            </span>
            {videoCount > 0 && (
              <span className="flex items-center gap-1.5">
                <Camera size={15} />
                <strong className="text-foreground">{videoCount}</strong> Videos
              </span>
            )}
            {project.allow_download && (
              <span className="text-xs bg-zinc-100 px-3 py-1 rounded-full">
                Downloads enabled
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Link
              href={`/gallery/${slug}/moodboard`}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3.5 py-1.5 rounded-xs bg-zinc-900 text-white hover:bg-zinc-800 transition-colors shadow-xs"
            >
              <Sparkles size={13} className="text-amber-300" />
              <span>Visual Moodboard</span>
            </Link>
          </div>
        </div>
      </div>

      {/* ── Gallery Grid ─────────────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-4 py-10">
        <GalleryGrid
          items={media as GalleryMediaItem[]}
          projectId={project.id}
          slug={slug}
          initialFavoritedIds={favoritedIds}
          allowDownload={project.allow_download}
          selectionQuotaMin={project.selection_quota_min ?? 15}
          selectionQuotaMax={project.selection_quota_max ?? 20}
          selectionLockedAt={project.selection_locked_at}
        />
      </div>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-border py-8 text-center">
        <Link href="/" className="wordmark text-2xl">
          Elts.
        </Link>
        <p className="mt-2 text-xs text-muted-foreground">
          Photography for real moments.
        </p>
      </footer>
    </main>
  );
}

// ── Gallery Unavailable State ─────────────────────────────────────────────────
function GalleryUnavailable({ message }: { message: string }) {
  return (
    <main className="min-h-svh flex items-center justify-center bg-[#F7F7F5]">
      <div className="text-center max-w-sm px-6">
        <Link href="/" className="wordmark text-3xl block mb-10">
          Elts.
        </Link>
        <LockKeyhole size={32} className="mx-auto text-muted-foreground mb-4" />
        <h1 className="font-serif text-2xl font-bold mb-3">Gallery Unavailable</h1>
        <p className="text-muted-foreground leading-relaxed">{message}</p>
        <Link
          href="/client"
          className="mt-8 inline-block text-sm underline underline-offset-4 text-muted-foreground hover:text-foreground"
        >
          Back to Client Area
        </Link>
      </div>
    </main>
  );
}
