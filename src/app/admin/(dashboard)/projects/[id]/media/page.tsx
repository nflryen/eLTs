import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOps } from "@/lib/auth/roles";
import { ArrowLeft, Image as ImageIcon, Video, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UploadDropzone } from "@/components/admin/upload-dropzone";
import { MediaGrid } from "@/components/admin/media-grid";
import type { ProjectRow, MediaRow } from "@/types/database";

interface Props {
  params: Promise<{ id: string }>;
}

type MediaWithFavorites = Pick<
  MediaRow,
  | "id"
  | "type"
  | "file_name"
  | "thumbnail_key"
  | "cloudinary_public_id"
  | "width"
  | "height"
  | "file_size"
  | "created_at"
> & { favorites: { count: number }[] };

export default async function MediaPage({ params }: Props) {
  const { id } = await params;
  const { supabase } = await requireOps();

  const { data: projectData } = await supabase
    .from("projects")
    .select("id, name, slug, status")
    .eq("id", id)
    .single();

  if (!projectData) notFound();

  const project = projectData as Pick<
    ProjectRow,
    "id" | "name" | "slug" | "status"
  >;

  const { data: mediaData, count } = await supabase
    .from("media")
    .select(
      "id, type, file_name, thumbnail_key, cloudinary_public_id, width, height, file_size, created_at, favorites(count)",
      {
        count: "exact",
      },
    )
    .eq("project_id", id)
    .order("created_at", { ascending: false });

  const media = ((mediaData ?? []) as unknown as MediaWithFavorites[]).map(
    (m) => ({
      id: m.id,
      type: m.type,
      file_name: m.file_name,
      thumbnail_key: m.cloudinary_public_id
        ? `/api/admin/media/${m.id}/thumbnail`
        : m.thumbnail_key,
      width: m.width,
      height: m.height,
      file_size: m.file_size,
      created_at: m.created_at,
      favorites_count: m.favorites?.[0]?.count ?? 0,
    }),
  );

  const totalCount = count ?? 0;
  const imageCount = media.filter((m) => m.type === "image").length;
  const videoCount = media.filter((m) => m.type === "video").length;

  return (
    <div className="max-w-5xl">
      {/* Breadcrumb */}
      <div className="mb-6">
        <Link
          href={`/admin/projects/${id}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={15} /> {project.name}
        </Link>
      </div>

      {/* Header */}
      <div className="mb-8">
        <p className="eyebrow mb-2">Media Management</p>
        <h1 className="font-serif text-3xl font-bold">Upload & Manage</h1>
        <p className="mt-2 text-muted-foreground">
          Upload photos and videos for <strong>{project.name}</strong>
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { icon: null, label: "Total Files", value: totalCount },
          { icon: ImageIcon, label: "Photos", value: imageCount },
          { icon: Video, label: "Videos", value: videoCount },
        ].map(({ label, value, icon: Icon }) => (
          <div
            key={label}
            className="bg-white border border-border rounded-lg p-5 shadow-sm"
          >
            <p className="text-2xl font-semibold">{value}</p>
            <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-1.5">
              {Icon && <Icon size={13} />}
              {label}
            </p>
          </div>
        ))}
      </div>

      {/* Upload Dropzone */}
      <div className="bg-white border border-border rounded-lg p-6 shadow-sm mb-8">
        <h2 className="font-semibold text-sm mb-5">Upload Files</h2>
        <UploadDropzone projectId={id} />
      </div>

      {/* Media Grid */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-sm">
            Uploaded Media{totalCount > 0 ? ` (${totalCount})` : ""}
          </h2>
          <Button variant="outline" size="sm" asChild>
            <Link
              href={`/api/admin/projects/${id}/export-favorites`}
              target="_blank"
            >
              <Download size={14} className="mr-2" /> Export Favorites
            </Link>
          </Button>
        </div>
        <MediaGrid media={media} />
      </div>
    </div>
  );
}
