/**
 * Client-side helper for uploading images to Cloudinary via the /api/upload endpoint.
 * Handles FormData creation, error parsing, and returns the public secure URL.
 */
export async function uploadImageToCloudinary(
  file: File,
  folder: string = "portfolio",
): Promise<string> {
  if (!file) throw new Error("File gambar wajib dipilih.");

  const maxBytes = 20 * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new Error("Ukuran file maksimal 20MB.");
  }

  const fd = new FormData();
  fd.append("file", file);
  fd.append("folder", folder);

  const res = await fetch("/api/upload", {
    method: "POST",
    body: fd,
  });

  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    throw new Error(json?.error || `Gagal mengunggah gambar (HTTP ${res.status})`);
  }

  const url = (json.secure_url || json.url) as string;
  if (!url) throw new Error("Server tidak mengembalikan URL gambar.");

  return url;
}
