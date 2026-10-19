"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Check } from "lucide-react";

interface CopyButtonProps {
  value: string;
  label: string;
}

export function CopyButton({ value, label }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  const copyText = async (text: string) => {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch {
        // Fall back when the browser rejects clipboard access for this context.
      }
    }

    // Clipboard API is unavailable on some non-secure local deployments.
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();

    try {
      if (!document.execCommand("copy")) {
        throw new Error("Copy command was rejected");
      }
    } finally {
      textarea.remove();
    }
  };

  const handleCopy = async () => {
    if (!value) return;

    try {
      await copyText(value);
      setCopyFailed(false);
      setCopied(true);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy", err);
      setCopied(false);
      setCopyFailed(true);
    }
  };

  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      onClick={handleCopy}
      title={copyFailed ? "Copy failed" : copied ? "Copied" : `Copy ${label}`}
      className="text-xs min-h-11 inline-flex items-center gap-1 text-fog hover:text-obsidian transition-colors cursor-pointer"
    >
      {copied ? <Check size={12} className="text-obsidian" /> : <Copy size={12} />}
      <span className={copied ? "text-obsidian font-medium" : copyFailed ? "text-ember" : "underline underline-offset-2"}>
        {copied ? "Copied" : copyFailed ? "Retry" : "Copy"}
      </span>
    </button>
  );
}
