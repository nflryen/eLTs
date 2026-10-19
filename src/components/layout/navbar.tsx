"use client";

import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { Menu, X, ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { navigation } from "@/config/site";
import { Button } from "@/components/ui/button";

export function Navbar() {
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="site-container flex h-22 items-center justify-between gap-6">
        <Link href="/" aria-label="Elts. home" className="wordmark">
          Elts.
        </Link>
        <nav
          aria-label="Main navigation"
          className="hidden items-center gap-8 md:flex"
        >
          {navigation.map((item) => (
            <Link key={item.label} className="nav-link" href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link href="/client">
              Client Area <ArrowUpRight className="size-3.5!" />
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
              <Dialog.Overlay className="fixed inset-0 z-50 bg-black/35 backdrop-blur-sm" />
              <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-[min(85vw,360px)] flex-col bg-background px-8 py-8 shadow-xl">
                <Dialog.Title className="wordmark">Elts.</Dialog.Title>
                <Dialog.Description className="mt-2 text-sm text-muted-foreground">
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
                      className="font-serif text-3xl"
                      key={item.label}
                      onClick={() => setOpen(false)}
                      href={item.href}
                    >
                      {item.label}
                    </Link>
                  ))}
                  <Button asChild className="mt-5">
                    <Link onClick={() => setOpen(false)} href="/client">
                      Client Area <ArrowUpRight />
                    </Link>
                  </Button>
                </nav>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
      </div>
    </header>
  );
}
