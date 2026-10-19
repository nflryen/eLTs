"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="main-content" className="site-container py-28">
      <p className="eyebrow">A small interruption</p>
      <h1 className="section-heading mt-5">Let’s try that again.</h1>
      <p className="mt-5 text-muted-foreground">
        We couldn’t load this page. Please try again in a moment.
      </p>
      <Button onClick={reset} className="mt-7">
        Try again
      </Button>
    </main>
  );
}
