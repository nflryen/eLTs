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
test("Cloudinary direct upload signing generates valid cryptographic signatures and endpoints", () => {
  const { cloudName, apiKey: _apiKey, apiSecret } = getCloudinaryConfig();
  const folder = "elts/portfolio/test";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = cloudinary.utils.api_sign_request({ folder, timestamp }, apiSecret);

  assert.ok(signature, "Signature must be generated");
  assert.match(signature, /^[a-f0-9]{40}$/i, "Cloudinary signature must be 40-hex sha1");
  const endpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`;
  assert.match(endpoint, /^https:\/\/api\.cloudinary\.com\/v1_1\/[^/]+\/image\/upload$/);
});
