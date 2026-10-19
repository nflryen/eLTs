import Link from "next/link";
import { Button } from "@/components/ui/button";
export default function NotFound() {
  return (
    <main id="main-content" className="site-container py-28">
      <Link href="/" className="wordmark">
        Elts.
      </Link>
      <p className="eyebrow mt-16">404 · Out of frame</p>
      <h1 className="section-heading mt-5">This page isn’t here.</h1>
      <p className="mt-5 text-muted-foreground">
        Let’s find your way back to the story.
      </p>
      <Button asChild className="mt-7">
        <Link href="/">Back to Home</Link>
      </Button>
    </main>
  );
}
