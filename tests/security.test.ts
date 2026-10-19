import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  canAccessGallery,
  canAccessMedia,
  type GalleryProjectPolicy,
  type GallerySessionPolicy,
} from "../src/lib/security/access-policy";
import {
  createOpaqueSession,
  generateGalleryCredentials,
  hashGalleryPin,
  hashSessionToken,
  verifyGalleryPin,
} from "../src/lib/security/credentials";

const now = new Date("2026-09-18T12:00:00Z");
const session: GallerySessionPolicy = {
  projectId: "project-a",
  galleryAccess: true,
  expiresAt: new Date("2026-09-19T12:00:00Z"),
  revokedAt: null,
};
const project: GalleryProjectPolicy = {
  id: "project-a",
  status: "ready",
  expiresAt: null,
  allowDownload: false,
};

test("PIN hashing uses unique salts; verification rejects incorrect PIN and pepper", async () => {
  const pepper = randomBytes(32).toString("base64url");
  const first = await hashGalleryPin("012345", pepper);
  const second = await hashGalleryPin("012345", pepper);
  assert.notEqual(first, second);
  assert.equal(first.includes("012345"), false);
  assert.equal(await verifyGalleryPin("012345", first, pepper), true);
  assert.equal(await verifyGalleryPin("999999", first, pepper), false);
  assert.equal(
    await verifyGalleryPin(
      "012345",
      first,
      randomBytes(32).toString("base64url"),
    ),
    false,
  );
  assert.equal(await verifyGalleryPin("012345", "malformed", pepper), false);
  await assert.rejects(hashGalleryPin("123", pepper));
  await assert.rejects(hashGalleryPin("012345", "short"));
});

test("gallery credentials and sessions have independent cryptographic tokens", () => {
  const one = generateGalleryCredentials();
  const two = generateGalleryCredentials();
  assert.match(one.pin, /^\d{6}$/);
  assert.match(one.galleryCode, /^ELTS-[A-Z0-9]{8}$/);
  assert.match(one.accessToken, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(one.accessToken, two.accessToken);
  const auth = createOpaqueSession();
  assert.notEqual(auth.token, auth.tokenHash);
  assert.equal(hashSessionToken(auth.token), auth.tokenHash);
});

test("access is project-scoped and original downloads require permission", () => {
  assert.equal(canAccessGallery(session, project, now), true);
  assert.equal(
    canAccessGallery({ ...session, projectId: "project-b" }, project, now),
    false,
  );
  assert.equal(
    canAccessMedia(session, project, "project-b", "preview", now),
    false,
  );
  assert.equal(
    canAccessMedia(session, project, "project-a", "preview", now),
    true,
  );
  assert.equal(
    canAccessMedia(session, project, "project-a", "download", now),
    false,
  );
  assert.equal(
    canAccessMedia(
      session,
      { ...project, allowDownload: true },
      "project-a",
      "download",
      now,
    ),
    true,
  );
});

test("status, expiry, revocation and invalid timestamps fail closed", () => {
  for (const status of ["draft", "editing", "expired", "archived"] as const)
    assert.equal(canAccessGallery(session, { ...project, status }, now), false);
  assert.equal(
    canAccessGallery(session, { ...project, expiresAt: now }, now),
    false,
  );
  assert.equal(
    canAccessGallery({ ...session, expiresAt: now }, project, now),
    false,
  );
  assert.equal(
    canAccessGallery({ ...session, revokedAt: now }, project, now),
    false,
  );
  assert.equal(
    canAccessGallery({ ...session, galleryAccess: false }, project, now),
    false,
  );
  assert.equal(
    canAccessGallery(
      { ...session, expiresAt: new Date("invalid") },
      project,
      now,
    ),
    false,
  );
  assert.equal(
    canAccessGallery(
      session,
      { ...project, expiresAt: new Date("invalid") },
      now,
    ),
    false,
  );
});
