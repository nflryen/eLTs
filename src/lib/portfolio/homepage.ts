import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";
import { normaliseLayout } from "@/lib/portfolio/layout";
import { featuredWorks } from "@/content/photography";

export type HomepageFeaturedWork = {
  id: string;
  src: string;
  alt: string;
  title: string;
  category: string;
  slug: string;
};

/**
 * Calculates a deterministic daily rotation offset so the featured photo
 * order rotates automatically every 24 hours based on the Jakarta calendar day.
 */
function getDailyRotationOffset(length: number): number {
  if (length <= 1) return 0;
  // Jakarta calendar day calculation
  const now = new Date();
  const jktDateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  const [y, m, d] = jktDateStr.split("-").map(Number);
  const jktDate = new Date(Date.UTC(y, m - 1, d));
  const yearStart = new Date(Date.UTC(y, 0, 1));
  const dayOfYear = Math.floor((jktDate.getTime() - yearStart.getTime()) / (24 * 60 * 60 * 1000));

  return dayOfYear % length;
}

/**
 * Loads featured homepage works dynamically from published showcase pages and sections.
 * Falls back gracefully to curated seed items if no showcase rows are published yet.
 */
export async function getHomepageFeaturedWorks(): Promise<HomepageFeaturedWork[]> {
  try {
    let supabase;
    try {
      supabase = await createServerSupabase();
    } catch {
      const { createClient } = await import("@supabase/supabase-js");
      supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy.supabase.co",
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "dummy"
      );
    }

    // 1. Fetch all published showcase pages
    const { data: pages, error: pagesError } = await supabase
      .from("portfolio_pages")
      .select("id, slug, title, cover_url, category, sort_order")
      .eq("status", "published")
      .order("sort_order", { ascending: true })
      .order("published_at", { ascending: false });

    if (pagesError || !pages || pages.length === 0) {
      return getFallbackFeaturedWorks();
    }

    const pageIds = pages.map((p) => p.id);
    const pageMap = new Map(pages.map((p) => [p.id, p]));

    // 2. Fetch sections belonging to these published pages
    const { data: sections, error: secError } = await supabase
      .from("portfolio_sections")
      .select("id, page_id, layout, sort_order")
      .in("page_id", pageIds)
      .order("sort_order", { ascending: true });

    if (secError || !sections || sections.length === 0) {
      // If sections missing but cover_urls exist, use covers
      const coverItems: HomepageFeaturedWork[] = pages
        .filter((p) => Boolean(p.cover_url))
        .map((p) => ({
          id: `cover-${p.id}`,
          src: p.cover_url!,
          alt: p.title,
          title: p.title,
          category: (p as unknown as { category?: string }).category ?? "Showcase",
          slug: p.slug,
        }));

      if (coverItems.length > 0) {
        return rotateItems(coverItems);
      }
      return getFallbackFeaturedWorks();
    }

    // 3. Extract high-resolution photo blocks
    const dynamicItems: HomepageFeaturedWork[] = [];
    const seenUrls = new Set<string>();

    for (const sec of sections) {
      const page = pageMap.get(sec.page_id);
      if (!page) continue;

      const norm = normaliseLayout(sec.layout);
      const photoBlocks = norm.blocks.filter((b) => b.type === "photo" && Boolean(b.publicUrl));

      for (const b of photoBlocks) {
        if (!b.publicUrl || seenUrls.has(b.publicUrl)) continue;
        seenUrls.add(b.publicUrl);

        dynamicItems.push({
          id: `${sec.id}-${b.id}`,
          src: b.publicUrl,
          alt: `${page.title} — Elts. Photography`,
          title: page.title,
          category: (page as unknown as { category?: string }).category ?? "Showcase",
          slug: page.slug,
        });
      }
    }

    // If dynamic items found, apply rotational algorithm
    if (dynamicItems.length > 0) {
      return rotateItems(dynamicItems);
    }

    return getFallbackFeaturedWorks();
  } catch (error) {
    console.error("getHomepageFeaturedWorks failed:", error);
    return getFallbackFeaturedWorks();
  }
}

/**
 * Rotates an array of items based on daily offset.
 */
function rotateItems(items: HomepageFeaturedWork[]): HomepageFeaturedWork[] {
  if (items.length <= 1) return items;
  const offset = getDailyRotationOffset(items.length);
  return [...items.slice(offset), ...items.slice(0, offset)];
}

/**
 * Clean fallback from curated static photography content.
 */
function getFallbackFeaturedWorks(): HomepageFeaturedWork[] {
  const mapped: HomepageFeaturedWork[] = featuredWorks.map((fw) => ({
    id: fw.id,
    src: fw.src,
    alt: fw.alt,
    title: fw.title,
    category: fw.category,
    slug: "risma-her-gang",
  }));
  return rotateItems(mapped);
}
