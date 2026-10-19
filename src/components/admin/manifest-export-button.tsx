"use client";

import { useState, useRef, useEffect } from "react";
import { Download, Copy, Check, FileCode, ListFilter, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ManifestItem {
  media_id?: string;
  file_name?: string;
  original_key?: string;
  mime_type?: string;
  storage_provider?: string;
  [key: string]: unknown;
}

interface ManifestExportButtonProps {
  projectName: string;
  projectSlug: string;
  filenames: string[];
  manifest: ManifestItem[];
}

export function ManifestExportButton({
  projectName,
  projectSlug,
  filenames,
  manifest,
}: ManifestExportButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [copiedType, setCopiedType] = useState<"filenames" | "json" | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const copyToClipboard = async (text: string, type: "filenames" | "json") => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopiedType(type);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        setCopiedType(null);
      }, 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const downloadJson = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(
      JSON.stringify(
        {
          project: projectName,
          slug: projectSlug,
          exported_at: new Date().toISOString(),
          deliverable_count: filenames.length,
          files: filenames,
          manifest,
        },
        null,
        2
      )
    );
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `${projectSlug}-editing-manifest.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const count = filenames.length;

  return (
    <div className="relative inline-block text-left">
      <Button
        size="sm"
        variant="outline"
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-1.5"
      >
        <Download size={14} /> Export Manifest
      </Button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="relative w-full max-w-lg bg-white rounded-lg shadow-xl border border-border p-6 space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-base text-[#09090b]">
                  Export Editing Manifest
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {projectName} ({count} selected {count === 1 ? "file" : "files"})
                </p>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="inline-flex min-h-11 min-w-11 items-center justify-center text-fog hover:text-[#09090b] p-1 rounded-md"
              >
                <X size={18} />
              </button>
            </div>

            {/* Quick Actions */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Button
                variant="outline"
                className="flex items-center justify-start gap-2 h-auto py-2.5 px-3 text-left"
                onClick={() => copyToClipboard(filenames.join(" "), "filenames")}
                disabled={count === 0}
              >
                {copiedType === "filenames" ? (
                  <Check size={16} className="text-[#09090b] shrink-0" />
                ) : (
                  <ListFilter size={16} className="text-[#52525b] shrink-0" />
                )}
                <div>
                  <div className="text-xs font-medium">
                    {copiedType === "filenames" ? "Copied to Clipboard!" : "Copy Lightroom Filter"}
                  </div>
                  <div className="text-[11px] text-muted-foreground">Space-separated filenames</div>
                </div>
              </Button>

              <Button
                variant="outline"
                className="flex items-center justify-start gap-2 h-auto py-2.5 px-3 text-left"
                onClick={downloadJson}
                disabled={count === 0}
              >
                <FileCode size={16} className="text-[#52525b] shrink-0" />
                <div>
                  <div className="text-xs font-medium">Download JSON</div>
                  <div className="text-[11px] text-muted-foreground">For automated post-prod</div>
                </div>
              </Button>
            </div>

            {/* Preview of Filenames */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-[#3f3f46]">Selected Filenames</span>
                <button
                  onClick={() => copyToClipboard(filenames.join("\n"), "filenames")}
                  className="text-[11px] min-h-11 inline-flex items-center gap-1 text-[#52525b] hover:text-[#09090b]"
                  disabled={count === 0}
                >
                  <Copy size={12} /> Copy list (newlines)
                </button>
              </div>
              <div className="max-h-40 overflow-y-auto rounded border border-border bg-[#fafafa] p-2.5 font-mono text-xs text-[#3f3f46] divide-y divide-[#ececee]">
                {count > 0 ? (
                  filenames.map((name, i) => (
                    <div key={i} className="py-0.5 truncate">
                      {name}
                    </div>
                  ))
                ) : (
                  <div className="text-muted-foreground italic py-2 text-center font-sans text-xs">
                    No files found in curation manifest.
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="flex justify-between items-center pt-2 border-t border-border">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => copyToClipboard(JSON.stringify(manifest, null, 2), "json")}
                disabled={count === 0}
                className="text-xs text-fog hover:text-[#09090b]"
              >
                {copiedType === "json" ? (
                  <Check size={14} className="mr-1 text-[#09090b]" />
                ) : (
                  <Copy size={14} className="mr-1" />
                )}
                {copiedType === "json" ? "JSON Copied" : "Copy Raw JSON"}
              </Button>
              <Button size="sm" onClick={() => setIsOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
