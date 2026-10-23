import { NextResponse } from "next/server";
import { requireOps } from "@/lib/auth/roles";
import { UnauthorizedError, ForbiddenError } from "@/lib/auth/admin";
import { uploadToCloudinary } from "@/services/cloudinary";

export const dynamic = "force-dynamic";

// 20MB maximum upload limit for portfolio images
const MAX_FILE_SIZE = 20 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
  "image/svg+xml",
  "image/heic",
  "image/heif",
]);

export async function POST(request: Request) {
  try {
    // 1. Authorize: Only studio operators (rank >= 80) can upload assets to Cloudinary
    await requireOps();

    // 2. Parse multipart form data
    const formData = await request.formData();
    const file = formData.get("file") ?? formData.get("image");

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { ok: false, error: "File gambar tidak ditemukan dalam permintaan." },
        { status: 400 },
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { ok: false, error: "Ukuran file melebihi batas maksimal 20MB." },
        { status: 400 },
      );
    }

    if (file.type && !ALLOWED_MIME_TYPES.has(file.type) && !file.type.startsWith("image/")) {
      return NextResponse.json(
        { ok: false, error: "Tipe file tidak didukung. Harap unggah file gambar (JPEG, PNG, WebP, dll)." },
        { status: 400 },
      );
    }

    const rawFolder = formData.get("folder");
    const folder = typeof rawFolder === "string" && rawFolder.trim()
      ? rawFolder.trim().replace(/[^a-zA-Z0-9_\-\/]/g, "")
      : "portfolio";

    const fileName = file instanceof File ? file.name : "upload.webp";
    const buffer = Buffer.from(await file.arrayBuffer());

    // 3. Upload to Cloudinary under the designated folder
    const result = await uploadToCloudinary(buffer, fileName, folder, "image");

    return NextResponse.json({
      ok: true,
      url: result.url,
      secure_url: result.url,
      public_id: result.publicId,
      width: result.width,
      height: result.height,
      format: result.format,
      bytes: result.bytes,
    });
  } catch (err: unknown) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: "Akses ditolak: Masuk terlebih dahulu." }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ ok: false, error: "Akses ditolak: Izin tidak mencukupi." }, { status: 403 });
    }
    const message = err instanceof Error
      ? err.message
      : typeof err === "object" && err !== null && "message" in err
        ? String((err as { message: unknown }).message)
        : "Gagal mengunggah gambar ke Cloudinary.";
    console.error("upload_api_failed", { message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
