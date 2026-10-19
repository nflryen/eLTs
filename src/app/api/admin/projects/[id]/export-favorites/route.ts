import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/auth/admin";

/*
 * This endpoint returns a plain-text .txt download consumed programmatically,
 * so authentication failures answer 401 JSON rather than redirecting. The
 * previous shape wrapped the whole body in one try/catch, which swallowed the
 * auth throw into a generic 500 and hid the real cause.
 */
export const GET = withAdmin<{ id: string }>(
  async ({ params, supabase }) => {
    const { id } = params;

    const { data: project } = await supabase
      .from("projects")
      .select("name, slug")
      .eq("id", id)
      .single();

    if (!project) {
      return new NextResponse("Project not found", { status: 404 });
    }

    /*
     * `favorites(count)` is an embedded aggregate that supabase-js returns as an
     * array of `{ count }`. Naming the shape replaces the previous `any` calls
     * and makes the filter's assumptions checkable by the compiler.
     */
    type MediaWithFavoriteCount = {
      file_name: string;
      favorites: Array<{ count: number }> | null;
    };

    const { data: media } = await supabase
      .from("media")
      .select("file_name, favorites(count)")
      .eq("project_id", id);

    const rows = (media ?? []) as unknown as MediaWithFavoriteCount[];
    const favoritedMedia = rows
      .filter((m) => (m.favorites?.[0]?.count ?? 0) > 0)
      .map((m) => m.file_name)
      .sort();

    const fileContent = [
      `Favorites Export for ${project.name}`,
      `Generated: ${new Date().toLocaleString()}`,
      `Total Favorites: ${favoritedMedia.length}`,
      "----------------------------------------",
      ...favoritedMedia,
    ].join("\n");

    const dateStr = new Date().toISOString().split("T")[0];
    const filename = `favorites-${project.slug}-${dateStr}.txt`;

    return new NextResponse(fileContent, {
      status: 200,
      headers: {
        "Content-Type": "text/plain",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  },
);
