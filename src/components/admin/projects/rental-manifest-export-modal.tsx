"use client";

import { useState, useTransition, useEffect, useMemo } from "react";
import {
  FileText,
  Printer,
  Copy,
  Check,
  X,
  ExternalLink,
  Store,
  Calendar,
  MessageCircle,
  Loader2,
  Package,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getVendorRentalManifest } from "@/app/actions/admin-inventory";
import type { VendorRentalManifest, VendorRentalManifestItem } from "@/types/inventory";
import type { ProjectExpenseRow } from "@/types/operations";

interface RentalManifestExportModalProps {
  projectId: string;
  projectName: string;
  shootDate?: string | null;
  expenses: ProjectExpenseRow[];
  triggerClassName?: string;
}

function formatIDR(amount: number): string {
 return new Intl.NumberFormat("id-ID", {
 style: "currency",
 currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

export function RentalManifestExportModal({
  projectId,
  projectName,
  shootDate,
  expenses,
  triggerClassName,
}: RentalManifestExportModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [manifest, setManifest] = useState<VendorRentalManifest | null>(null);
  const [copied, setCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Extract unique vendor names from expenses
  const availableVendors = useMemo(() => {
    const vendorsSet = new Set<string>();
    for (const exp of expenses) {
      if (exp.vendor_name && exp.vendor_name.trim().length > 0) {
        vendorsSet.add(exp.vendor_name.trim());
 } else if (exp.notes && exp.notes.toLowerCase().includes("koi")) {
 vendorsSet.add("Koi Rental Purwokerto");
 } else if (exp.source_type === "VENDOR_RENTAL") {
 vendorsSet.add(exp.owner_name || "Koi Rental Purwokerto");
      }
    }

    const list = Array.from(vendorsSet);
    if (list.length === 0) {
 list.push("Koi Rental Purwokerto");
    }
    return list;
  }, [expenses]);

 const [selectedVendor, setSelectedVendor] = useState<string>(availableVendors[0] || "Koi Rental Purwokerto");

  // Fetch or generate manifest when modal opens or vendor changes
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    startTransition(async () => {
      setErrorMessage(null);
      try {
        const result = await getVendorRentalManifest(projectId, selectedVendor);
        if (!isMounted) return;

        if (result.success && result.manifest) {
          setManifest(result.manifest);
        } else {
 setErrorMessage(result.error || "Gagal memuat manifest vendor.");
        }
      } catch (err: unknown) {
        if (!isMounted) return;
        setErrorMessage(
 err instanceof Error ? err.message : "Terjadi kesalahan saat memuat manifest."
        );
      }
    });

    return () => {
      isMounted = false;
    };
  }, [isOpen, selectedVendor, projectId]);

  const handleCopyWhatsApp = () => {
    if (!manifest?.whatsAppMessage) return;
    navigator.clipboard.writeText(manifest.whatsAppMessage);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  const handlePrint = () => {
    window.print();
  };

  const waPhoneClean = manifest?.vendorPhone
 ? manifest.vendorPhone.replace(/[^0-9]/g, "").replace(/^0/, "62")
 : "6281327889900";

  const waLink = manifest?.whatsAppMessage
 ? `https://wa.me/${waPhoneClean}?text=${encodeURIComponent(manifest.whatsAppMessage)}`
 : "#";

  return (
    <>
      {/* Trigger Button */}
      <Button
 type="button"
 variant="outline"
 size="sm"
        onClick={() => setIsOpen(true)}
        className={
          triggerClassName ||
          "bg-white border-[#ececee] hover:border-[#ff5a00] hover:text-[#ff5a00] text-xs min-h-11 px-3.5 flex items-center gap-1.5 shadow-2xs cursor-pointer font-medium"
        }
      >
        <FileText size={14} className="text-[#ff5a00] shrink-0" />
        <span>📄 Export PO Vendor Rental</span>
      </Button>

      {/* Modal Dialog */}
      {isOpen && (
 <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
        <div className="bg-white rounded-[20px] shadow-2xl border border-[#ececee] max-w-3xl w-full my-auto animate-in fade-in zoom-in-95 max-h-[92vh] flex flex-col">
            {/* Modal Header */}
          <div className="flex items-center justify-between p-4 sm:p-5 border-b border-[#ececee] shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-[12px] bg-[#ff5a00]/5 text-[#ff5a00] flex items-center justify-center shrink-0">
                  <FileText size={18} />
                </div>
                <div>
                <h3 className="font-bold text-base text-[#09090b] font-serif">
                    Purchase Order & Manifest Rental Vendor
                  </h3>
                  <p className="text-xs text-[#52525b] ">
                    Dokumen resmi pemesanan unit sewa & template konfirmasi WhatsApp
                  </p>
                </div>
              </div>
              <button
 type="button"
                onClick={() => setIsOpen(false)}
                className="inline-flex min-h-11 min-w-11 items-center justify-center text-[#a1a1aa] hover:text-[#52525b] p-1.5 rounded-[10px] hover:bg-[#fafafa] cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Vendor Selector & Action Buttons Bar */}
          <div className="p-4 bg-[#fafafa] border-b border-[#ececee] flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
 <div className="flex items-center gap-2">
              <Store size={15} className="text-[#52525b] shrink-0" />
              <span className="text-xs font-semibold text-[#52525b] whitespace-nowrap">
                  Pilih Vendor Rental:
                </span>
                <select
                  value={selectedVendor}
                  onChange={(e) => setSelectedVendor(e.target.value)}
                  className="text-xs bg-white border border-[#ececee] rounded-[10px] px-2.5 py-2 font-medium text-[#09090b] focus:outline-none focus:ring-2 focus:ring-[#ff5a00] cursor-pointer"
                >
                  {availableVendors.map((vendor) => (
                    <option key={vendor} value={vendor}>
                      {vendor}
                    </option>
                  ))}
                </select>
              </div>

 <div className="flex items-center gap-2 flex-wrap">
                <Button
 type="button"
 variant="outline"
 size="sm"
                  onClick={handlePrint}
                  className="text-xs min-h-11 px-3 flex items-center gap-1.5 bg-white "
                >
                  <Printer size={13} />
                  <span>Cetak / PDF</span>
                </Button>

                <Button
 type="button"
 size="sm"
                  onClick={handleCopyWhatsApp}
                  className="bg-[#09090b] hover:bg-[#27272a] text-white text-xs min-h-11 px-3.5 flex items-center gap-1.5 shadow-2xs cursor-pointer"
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
 <span>{copied ? "Disalin!" : "Salin Pesan WA"}</span>
                </Button>

                <a
                  href={waLink}
 target="_blank"
 rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs min-h-11 px-3.5 rounded-[10px] bg-[#ff5a00]/5 border border-[#ff5a00]/50 text-[#ff5a00] hover:bg-[#ff5a00]/10 transition font-medium"
                >
                  <MessageCircle size={13} />
                  <span>Buka WA</span>
 <ExternalLink size={10} className="opacity-60" />
                </a>
              </div>
            </div>

            {/* Modal Body - Printable View & WhatsApp Box */}
 <div className="p-5 space-y-6 overflow-y-auto flex-1">
              {isPending ? (
              <div className="py-12 flex flex-col items-center justify-center text-[#a1a1aa] gap-2">
                <Loader2 size={24} className="animate-spin text-[#ff5a00]" />
 <span className="text-xs">Memformat manifest rental vendor...</span>
                </div>
              ) : errorMessage ? (
              <div className="p-4 rounded-[12px] bg-[#ff5a00]/5 border border-[#ff5a00]/50 text-[#ff5a00] text-xs">
                  {errorMessage}
                </div>
              ) : manifest ? (
                <>
                  {/* PRINTABLE PURCHASE ORDER DOCUMENT */}
                  <div
 id="printable-po"
                  className="p-6 bg-white rounded-[16px] border border-[#ececee] text-[#09090b] space-y-5 print:p-0 print:border-none print:shadow-none"
                  >
                    {/* Studio Header */}
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-[#ececee] pb-4">
                      <div>
 <div className="flex items-center gap-2">
                      <span className="font-bold text-lg tracking-tight font-serif text-[#ff5a00] ">
                            ELTS. & KINEVA PRODUCTIONS
                          </span>
                        </div>
                      <p className="text-xs text-[#52525b] mt-0.5">
                          Production House, Broadcast Streaming & Creative Studio Banyumas
                        </p>
                      <p className="text-[11px] text-[#a1a1aa]">
                          Purwokerto, Jawa Tengah • admin@elts.id
                        </p>
                      </div>

 <div className="text-left sm:text-right">
                      <span className="inline-block px-2.5 py-1 rounded bg-[#ff5a00]/5 text-[#ff5a00] font-mono font-bold text-xs">
                          {manifest.poNumber}
                        </span>
                      <p className="text-[11px] text-[#52525b] mt-1 tabular-nums">
 Tanggal Terbit:{" "}
 {new Intl.DateTimeFormat("id-ID", {
 dateStyle: "medium",
                          }).format(new Date())}
                        </p>
                      </div>
                    </div>

                    {/* Metadata Grid */}
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div className="p-3 bg-[#fafafa] rounded-[12px] border border-[#ececee] space-y-1">
                        <span className="text-[10px] font-semibold text-[#a1a1aa] uppercase tracking-wider block">
                          Tujuan Pemesanan (Vendor):
                        </span>
                        <p className="font-bold text-sm text-[#09090b] ">
                          {manifest.vendorName}
                        </p>
                        {manifest.vendorPhone && (
                          <p className="text-[#52525b] font-mono text-[11px]">
                            WA / Telp: {manifest.vendorPhone}
                          </p>
                        )}
                        <p className="text-[#52525b] text-[11px]">Purwokerto & Sekitarnya</p>
                      </div>

                    <div className="p-3 bg-[#fafafa] rounded-[12px] border border-[#ececee] space-y-1">
                        <span className="text-[10px] font-semibold text-[#a1a1aa] uppercase tracking-wider block">
                          Untuk Keperluan Project:
                        </span>
                        <p className="font-bold text-sm text-[#09090b] ">
                          {manifest.projectName}
                        </p>
                        <div className="flex items-center gap-1.5 text-[#52525b] text-[11px]">
                        <Calendar size={12} className="text-[#ff5a00]" />
                          <span>
 Jadwal Event / Pakai:{" "}
                            <strong className="text-[#09090b] ">
                              {manifest.eventDate
 ? new Intl.DateTimeFormat("id-ID", {
 dateStyle: "long",
                                  }).format(new Date(manifest.eventDate))
 : "Akan diinfo (Menunggu Jadwal)"}
                            </strong>
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Equipment Table */}
 <div className="overflow-x-auto">
 <table className="w-full text-left text-xs">
                    <thead className="bg-[#fafafa] text-[#52525b] font-semibold border-b border-[#ececee] ">
                          <tr>
 <th className="py-2.5 px-3 w-10 text-center">No</th>
 <th className="py-2.5 px-3">Deskripsi Peralatan</th>
 <th className="py-2.5 px-3 text-center w-20">Qty</th>
 <th className="py-2.5 px-3 text-right">Tarif Sewa</th>
 <th className="py-2.5 px-3 text-right">Subtotal</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#ececee] ">
                          {manifest.items.map((item: VendorRentalManifestItem, idx: number) => (
                          <tr key={idx} className="hover:bg-[#fafafa]/50">
                            <td className="py-2.5 px-3 text-center text-[#a1a1aa] font-mono tabular-nums">
                                {idx + 1}
                              </td>
 <td className="py-2.5 px-3 font-medium">
                                <div>{item.name}</div>
                                {item.notes && (
                              <div className="text-[11px] text-[#a1a1aa] italic">
                                    {item.notes}
                                  </div>
                                )}
                              </td>
 <td className="py-2.5 px-3 text-center font-mono font-semibold">
                                {item.quantity}
                              </td>
                            <td className="py-2.5 px-3 text-right font-mono text-[#52525b] tabular-nums ">
                                {formatIDR(item.unit_cost)}
                              </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-[#09090b] tabular-nums ">
                                {formatIDR(item.total_cost)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      <tfoot className="border-t border-[#ececee] ">
                          <tr>
 <td colSpan={4} className="py-3 px-3 text-right font-bold uppercase text-xs">
                              Total Estimasi Biaya Sewa
                            </td>
                        <td className="py-3 px-3 text-right font-mono font-bold text-sm tabular-nums text-[#09090b] ">
                              {formatIDR(manifest.totalAmount)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    {/* Signature Block for Print */}
                  <div className="grid grid-cols-2 gap-8 pt-6 border-t border-[#ececee] text-center text-xs">
                      <div>
                      <p className="text-[#52525b] mb-14">Diajukan Oleh (Studio ELTS):</p>
                      <p className="font-semibold text-[#09090b] underline">
                          Tim Produksi & Logistik
                        </p>
                      </div>
                      <div>
                      <p className="text-[#52525b] mb-14">Diterima & Dikonfirmasi Oleh:</p>
                      <p className="font-semibold text-[#09090b] underline">
                          {manifest.vendorName}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* WHATSAPP COPY BOX */}
                <div className="p-4 rounded-[12px] bg-[#fafafa] border border-[#ececee] space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-[#09090b] ">
                      <MessageCircle size={15} className="text-[#ff5a00] shrink-0" />
                        <span>Format Pesan Booking WhatsApp (Siap Kirim)</span>
                      </div>
                      <button
 type="button"
                        onClick={handleCopyWhatsApp}
                        className="text-xs font-semibold text-[#09090b] hover:underline gap-1 cursor-pointer inline-flex min-h-11 items-center"
                      >
                        {copied ? <Check size={12} /> : <Copy size={12} />}
 <span>{copied ? "Tersalin!" : "Salin Teks"}</span>
                      </button>
                    </div>

                  <pre className="p-3 bg-white rounded-[10px] border border-[#ececee] text-xs font-mono text-[#52525b] whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                      {manifest.whatsAppMessage}
                    </pre>
                  </div>
                </>
              ) : null}
            </div>

            {/* Modal Footer */}
          <div className="p-4 border-t border-[#ececee] flex items-center justify-between text-xs text-[#52525b] shrink-0">
              <span>ELTS Master Inventory & Granular Vendor RAB Engine</span>
              <Button
 type="button"
 variant="outline"
 size="sm"
                onClick={() => setIsOpen(false)}
              >
                Tutup
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
