import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowUpRight, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { bookingUrl } from "@/config/site";
import { ClientAccessForm } from "@/components/client/client-access-form";

export const metadata: Metadata = {
  title: "Client Area",
  robots: { index: false, follow: false },
};

export default function ClientPage() {
  return (
    <main id="main-content" className="grid min-h-svh lg:grid-cols-2">
      <section className="relative isolate min-h-[420px] overflow-hidden px-8 py-10 text-white sm:px-14">
        <Image
          src="/images/bride.webp"
          alt="A quiet bridal portrait"
          fill
          loading="eager"
          sizes="(max-width: 1024px) 100vw, 50vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-black/45" />
        <div className="relative flex h-full min-h-[340px] flex-col justify-between">
          <Link href="/" className="wordmark">
            Elts.
          </Link>
          <div className="my-16">
            <p className="eyebrow text-white/80!">A space for your story</p>
            <h1 className="mt-5 font-serif text-6xl leading-none sm:text-7xl">
              Your Memories
              <br />
              <span className="italic">Are Here.</span>
            </h1>
          </div>
          <p className="flex items-center gap-3 text-sm">
            <LockKeyhole size={16} /> Private <span aria-hidden="true">·</span>{" "}
            Secure <span aria-hidden="true">·</span> Just for you
          </p>
        </div>
      </section>
      <section className="flex items-center justify-center px-7 py-16">
        <div className="w-full max-w-md border border-border bg-white px-7 py-10 sm:p-12">
          <p className="eyebrow">Client Area</p>
          <h2 className="mt-5 font-serif text-4xl">
            A little closer to
            <br />
            <span className="italic">your memories.</span>
          </h2>
          <p className="mt-6 leading-relaxed text-muted-foreground">
            Enter your gallery code and PIN to access your private collection.
          </p>
          <ClientAccessForm />
          
          <div className="mt-8 pt-8 border-t border-border">
            <p className="text-sm text-muted-foreground mb-4">
              Lost your access code?
            </p>
            <Button variant="outline" asChild className="w-full">
              <a
                href={bookingUrl("private gallery access recovery")}
                target="_blank"
                rel="noopener noreferrer"
              >
                Contact Elts. <ArrowUpRight className="ml-2 h-4 w-4" />
              </a>
            </Button>
          </div>
          <Link
            href="/"
            className="mt-6 block text-center text-sm text-muted-foreground underline underline-offset-4"
          >
            Back to the website
          </Link>
        </div>
      </section>
    </main>
  );
}
