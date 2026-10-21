"use client";

import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { Menu, X, ArrowUpRight } from "lucide-react";
import { useEffect, useState } from "react";
import { navigation } from "@/config/site";
import { Button } from "@/components/ui/button";

/*
 * Sticky SNOW navigation floating on the PAPER canvas.
 *
 * Per the Awesomic reference the bar carries no visible border until the page
 * scrolls — the surface contrast alone separates it from the canvas. A hairline
 * fades in on scroll so the bar stays legible over content.
 */
export function Navbar() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="site-header" data-scrolled={scrolled}>
      <div className="site-container flex h-[72px] items-center justify-between gap-6">
        <Link href="/" aria-label="Elts. home" className="wordmark">
          Elts.
        </Link>

        <nav
          aria-label="Main navigation"
          className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-8 md:flex"
        >
          {navigation.map((item) => (
            <Link key={item.label} className="nav-link" href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/client"
            className="hidden text-[14px] text-[var(--color-graphite)] transition-colors hover:text-[var(--color-obsidian)] sm:block"
          >
            Log in
          </Link>
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link href="/booking">
              Book a session <ArrowUpRight className="size-3.5!" />
            </Link>
          </Button>

          <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Trigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                aria-label="Open navigation"
              >
                <Menu />
              </Button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-50 bg-[#09090b]/30 backdrop-blur-sm" />
              <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-[min(85vw,360px)] flex-col bg-white px-8 py-8">
                <Dialog.Title className="wordmark">Elts.</Dialog.Title>
                <Dialog.Description className="mt-2 text-sm text-[var(--color-fog)]">
                  Photography for real moments.
                </Dialog.Description>
                <Dialog.Close asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-7 right-5"
                    aria-label="Close navigation"
                  >
                    <X />
                  </Button>
                </Dialog.Close>
                <nav
                  aria-label="Mobile navigation"
                  className="mt-12 flex flex-col gap-6"
                >
                  {navigation.map((item) => (
                    <Link
                      className="text-2xl font-semibold text-[var(--color-obsidian)]"
                      key={item.label}
                      onClick={() => setOpen(false)}
                      href={item.href}
                    >
                      {item.label}
                    </Link>
                  ))}
                  <Button asChild className="mt-5">
                    <Link onClick={() => setOpen(false)} href="/booking">
                      Book a session <ArrowUpRight />
                    </Link>
                  </Button>
                  <Link
                    onClick={() => setOpen(false)}
                    href="/client"
                    className="mt-2 text-sm text-[var(--color-fog)]"
                  >
                    Client area
                  </Link>
                </nav>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
      </div>
    </header>
  );
}
