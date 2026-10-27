import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getCloudinaryConfig } from "../src/lib/env";
import { v2 as cloudinary } from "cloudinary";

test("next.config.ts configures elevated serverActions bodySizeLimit to 50mb", () => {
  const content = readFileSync("next.config.ts", "utf-8");
  assert.match(content, /bodySizeLimit:\s*["']50mb["']/i);
});

test("src/app/api/upload/route.ts configures elevated 50MB file size limit and 60s timeout", () => {
  const content = readFileSync("src/app/api/upload/route.ts", "utf-8");
  assert.match(content, /MAX_FILE_SIZE\s*=\s*50\s*\*\s*1024\s*\*\s*1024/i);
  assert.match(content, /maxDuration\s*=\s*60/i);
});
test("Cloudinary direct upload signing generates valid cryptographic signatures and endpoints", async () => {
  const { cloudName, apiKey, apiSecret } = getCloudinaryConfig();
  const folder = "elts/portfolio/test";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = cloudinary.utils.api_sign_request({ folder, timestamp }, apiSecret);

  assert.ok(signature, "Signature must be generated");
  assert.match(signature, /^[a-f0-9]{40}$/i, "Cloudinary signature must be 40-hex sha1");
  const endpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`;
  assert.match(endpoint, /^https:\/\/api\.cloudinary\.com\/v1_1\/[^/]+\/image\/upload$/);

  const fd = new FormData();
  const png1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  fd.append("file", new Blob([png1x1], { type: "image/png" }), "pixel.png");
  fd.append("folder", folder);
  fd.append("timestamp", timestamp);
  fd.append("api_key", apiKey);
  fd.append("signature", signature);

  const res = await fetch(endpoint, { method: "POST", body: fd });
  assert.equal(res.status, 200, "Cloudinary direct upload must return 200 OK");
  const json = (await res.json()) as { secure_url?: string };
  assert.match(json.secure_url ?? "", /^https:\/\/res\.cloudinary\.com\//);
});

test("portfolio actions and form schemas accept JSON URL payloads and reject FormData or binary bodies", () => {
  const portfolioSource = readFileSync("src/app/actions/portfolio.ts", "utf-8");
  // Verify savePortfolioPage accepts z.input<typeof pageInputSchema> where coverUrl is a string URL
  assert.match(portfolioSource, /coverUrl:\s*z\.string\(\)\.max\(2048\)/);
  assert.doesNotMatch(portfolioSource, /savePortfolioPage\s*=\s*async\s*\([^)]*FormData/);

  // Verify page-list modal upload handler uploads to Cloudinary first and only stores the string URL
  const pageListSource = readFileSync("src/components/admin/portfolio/page-list.tsx", "utf-8");
  assert.match(pageListSource, /const url = await uploadImageToCloudinary\(file/);
  assert.match(pageListSource, /setCoverUrl\(url\)/);
  assert.match(pageListSource, /coverUrl:\s*coverUrl\.trim\(\)\s*\|\|\s*undefined/);
});
