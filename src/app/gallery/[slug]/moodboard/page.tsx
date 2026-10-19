import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { LockKeyhole } from "lucide-react";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getGallerySession } from "@/lib/auth/gallery";
import { getMoodboardData } from "@/app/actions/moodboard";
import { MoodboardView } from "@/components/client/moodboard/moodboard-view";
import type { ProjectRow } from "@/types/database";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: "Visual Brief & Moodboard — Elts.",
    description: "Collaborative visual direction, shot lists, and color palettes for production.",
    robots: { index: false, follow: false },
  };
}

export default async function GalleryMoodboardPage({ params }: Props) {
  const { slug } = await params;

  // 1. Session verification
  const gallerySession = await getGallerySession().catch(() => null);
  if (!gallerySession) {
    redirect(`/client?from=/gallery/${slug}/moodboard`);
  }

  const supabase = createServiceSupabase();

  // 2. Load project
  const { data: projectData } = await supabase
    .from("projects")
    .select(
      "id, name, slug, access_token, photography_type, shoot_date, status, expires_at"
    )
    .eq("id", gallerySession.project_id)
    .single();

  if (!projectData) {
    return <MoodboardUnavailable message="This moodboard project does not exist." />;
  }

  const project = projectData as Pick<
    ProjectRow,
    | "id"
    | "name"
    | "slug"
    | "access_token"
    | "photography_type"
    | "shoot_date"
    | "status"
    | "expires_at"
  >;

  // Security check: ensure session slug or access_token matches route param
  if (project.access_token !== slug && project.slug !== slug) {
    return (
      <MoodboardUnavailable message="This visual brief link is no longer valid or accessible." />
    );
  }

  // Status check
  if (project.status !== "ready") {
    return (
      <MoodboardUnavailable message="This visual brief is currently being prepared by our creative team. Please check back shortly." />
    );
  }

  // Expiration check
  if (project.expires_at && new Date(project.expires_at) < new Date()) {
    return (
      <MoodboardUnavailable message="Access to this visual brief has expired. Please contact Elts. Studio." />
    );
  }

  // 3. Load moodboard cards & comments
  const { cards } = await getMoodboardData(project.id);

  const formattedShootDate = project.shoot_date
    ? new Date(project.shoot_date).toLocaleDateString("id-ID", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <MoodboardView
      initialCards={cards}
      projectId={project.id}
      projectSlug={slug}
      projectName={project.name}
      shootDate={formattedShootDate}
      photographyType={project.photography_type}
      userRole="CLIENT"
      userName="Client"
    />
  );
}

function MoodboardUnavailable({ message }: { message: string }) {
  return (
    <main className="min-h-svh flex items-center justify-center bg-[#0E0E10] text-zinc-200">
      <div className="text-center max-w-sm px-6">
        <Link href="/" className="wordmark text-3xl block mb-10 text-white">
          Elts.
        </Link>
        <LockKeyhole size={32} className="mx-auto text-zinc-500 mb-4" />
        <h1 className="font-serif text-2xl font-bold mb-3 text-white">
          Visual Brief Unavailable
        </h1>
        <p className="text-zinc-400 text-xs leading-relaxed">{message}</p>
        <Link
          href="/client"
          className="mt-8 inline-block text-xs underline underline-offset-4 text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          Return to Client Portal
        </Link>
      </div>
    </main>
  );
}
