import test from "node:test";
import assert from "node:assert/strict";
import {
  provisionProjectDriveFolders,
  grantClientDriveAccess,
} from "../src/lib/sync/drive-client";

test("provisionProjectDriveFolders generates standard 3-tier folder hierarchy", async () => {
  const result = await provisionProjectDriveFolders({
    projectId: "a0000000-0000-0000-0000-000000000001",
    projectName: "Wedding Budi & Ani",
    servicePillar: "PICTURES_COMMERCIAL",
    year: 2026,
  });

  assert.ok(result.projectFolder, "Root project folder must be created");
  assert.match(result.projectFolder.name, /2026_PICTURES_COMMERCIAL_Wedding_Budi___Ani/);
  assert.match(result.projectFolder.url, /^https:\/\/drive\.google\.com\/drive\/folders\//);

  assert.ok(result.rawCaptureFolder, "01_RAW_Capture must be created");
  assert.equal(result.rawCaptureFolder.name, "01_RAW_Capture");

  assert.ok(result.selectionProofsFolder, "02_Selection_Proofs must be created");
  assert.equal(result.selectionProofsFolder.name, "02_Selection_Proofs");

  assert.ok(result.finalDeliverablesFolder, "03_Final_Deliverables must be created");
  assert.equal(result.finalDeliverablesFolder.name, "03_Final_Deliverables");
  assert.match(result.finalDeliverablesFolder.url, /^https:\/\/drive\.google\.com\/drive\/folders\//);
});

test("grantClientDriveAccess operates cleanly in mock mode", async () => {
  const res = await grantClientDriveAccess("mock_folder_12345", "client@example.com");
  assert.equal(res.success, true);
});
