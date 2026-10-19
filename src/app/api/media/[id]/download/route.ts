import { NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getGallerySession } from "@/lib/auth/gallery";
import { getAuthenticatedCloudinaryUrl, getCloudinaryUrl } from "@/services/cloudinary";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getGallerySession().catch(() => null);
  const { id } = await params;
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = createServiceSupabase();
  const { data: media } = await supabase.from("media").select("id, project_id, type, file_name, cloudinary_public_id, cloudinary_delivery_type").eq("id", id).eq("project_id", session.project_id).maybeSingle();
  let project: { allow_download: boolean; is_fully_paid: boolean } | null = null;
  const { data: fullProject } = await supabase.from("projects").select("allow_download, is_fully_paid").eq("id", session.project_id).maybeSingle();
  if (fullProject) {
    project = fullProject as { allow_download: boolean; is_fully_paid: boolean };
  } else {
    const { data: baseProject } = await supabase.from("projects").select("allow_download").eq("id", session.project_id).maybeSingle();
    if (baseProject) {
      project = { allow_download: (baseProject as { allow_download: boolean }).allow_download, is_fully_paid: false };
    }
  }
  if (!media || !project || !media.cloudinary_public_id) return NextResponse.json({ error: "Download unavailable" }, { status: 404 });
  if (!project.allow_download) return NextResponse.json({ error: "Download unavailable" }, { status: 404 });
  if (!project.is_fully_paid) {
    return NextResponse.json(
      {
        error: "PAYMENT_REQUIRED",
        message: "Aset resolusi tinggi terkunci hingga pelunasan invoice 100% terverifikasi.",
      },
      { status: 402 }
    );
  }
  const type = media.type === "video" ? "video" : "image";
  const delivery = media.cloudinary_delivery_type === "authenticated" ? getAuthenticatedCloudinaryUrl(media.cloudinary_public_id, "original", type) : getCloudinaryUrl(media.cloudinary_public_id, "original", type);
  const upstream = await fetch(delivery, { cache: "no-store" });
  if (!upstream.ok || !upstream.body) return NextResponse.json({ error: "Media unavailable" }, { status: 502 });
  return new Response(upstream.body, { headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(media.file_name)}`, "Cache-Control": "private, no-store" } });
}
