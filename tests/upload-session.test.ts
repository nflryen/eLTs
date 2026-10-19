import test from "node:test";
import assert from "node:assert/strict";
import { runUploadSession, type UploadProgress, type UploadSession } from "../src/lib/uploads/upload-session";
import type { SignedMediaUpload, UploadReceipt } from "../src/lib/uploads/policy";

const upload: SignedMediaUpload = { intent: "signed-intent", endpoint: "https://example.com/upload", fields: {}, publicId: "media/test" };
const receipt: UploadReceipt = { publicId: upload.publicId, version: 1, signature: "verified-receipt" };
const file = () => new File(["photo"], "photo.jpg", { type: "image/jpeg" });

test("retrying a failed gallery save retains the receipt and never uploads the file again", async () => {
  const session: UploadSession = { file: file() };
  const progress: UploadProgress[] = [];
  let prepares = 0;
  let transfers = 0;
  let saves = 0;
  const services = {
    prepare: async () => { prepares += 1; return { upload }; },
    transfer: async () => { transfers += 1; return receipt; },
    complete: async (intent: string, savedReceipt: UploadReceipt) => {
      assert.equal(intent, upload.intent);
      assert.deepEqual(savedReceipt, receipt);
      saves += 1;
      return saves === 1 ? { success: false, error: "Database temporarily unavailable." } : { success: true };
    },
  };
  await assert.rejects(runUploadSession(session, services, (value) => progress.push(value)), /Database temporarily unavailable/);
  assert.deepEqual(session.receipt, receipt);
  assert.equal(progress.at(-1)?.state, "saving");
  await runUploadSession(session, services, (value) => progress.push(value));
  assert.equal(prepares, 1);
  assert.equal(transfers, 1);
  assert.equal(saves, 2);
  assert.deepEqual(progress.at(-1), { state: "done", progress: 100 });
});

test("a transfer failure starts a newly authorized upload on retry", async () => {
  const session: UploadSession = { file: file() };
  let prepares = 0;
  let transfers = 0;
  let saves = 0;
  const services = {
    prepare: async () => { prepares += 1; return { upload: { ...upload, intent: `intent-${prepares}` } }; },
    transfer: async () => {
      transfers += 1;
      if (transfers === 1) throw new Error("Connection lost.");
      return receipt;
    },
    complete: async (intent: string) => { saves += 1; assert.equal(intent, "intent-2"); return { success: true }; },
  };
  await assert.rejects(runUploadSession(session, services, () => {}), /Connection lost/);
  assert.equal(session.receipt, undefined);
  assert.equal(saves, 0);
  await runUploadSession(session, services, () => {});
  assert.equal(prepares, 2);
  assert.equal(transfers, 2);
  assert.equal(saves, 1);
});

test("an interrupted save response is safely retried with the same upload receipt", async () => {
  const session: UploadSession = { file: file(), upload, receipt };
  let saves = 0;
  const services = {
    prepare: async () => { assert.fail("Must not prepare another upload"); },
    transfer: async () => { assert.fail("Must not transfer another file"); },
    complete: async () => { saves += 1; if (saves === 1) throw new Error("Response interrupted"); return { success: true }; },
  };
  await assert.rejects(runUploadSession(session, services, () => {}), /Response interrupted/);
  await runUploadSession(session, services, () => {});
  assert.equal(saves, 2);
});
