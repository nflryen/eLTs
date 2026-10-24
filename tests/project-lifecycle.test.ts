import test from "node:test";
import assert from "node:assert/strict";
import { legalNextStatuses, isLegalTransition, STATUS_LABEL, type ProjectStatus } from "../src/lib/projects/lifecycle";

/**
 * The transition map must stay identical to
 * `private.enforce_project_status_transition()` in migration 0006. If these
 * ever diverge the dropdown offers a move the database rejects.
 */
test("legal transitions mirror the database state machine", () => {
  assert.deepEqual(legalNextStatuses("draft").sort(), ["editing", "ready"]);
  assert.deepEqual(legalNextStatuses("editing").sort(), ["draft", "ready"]);
  assert.deepEqual(legalNextStatuses("ready").sort(), ["archived", "draft", "editing"]);
  assert.deepEqual(legalNextStatuses("archived").sort(), ["ready"]);
});

test("expired offers no operator-initiated transition", () => {
  // `expired` is time-driven; the database allows expired -> archived for the
  // system, but the dropdown must never offer it to a human.
  assert.deepEqual(legalNextStatuses("expired"), []);
});

test("illegal jumps are rejected", () => {
  assert.equal(isLegalTransition("draft", "archived"), false);
  assert.equal(isLegalTransition("archived", "editing"), false);
  assert.equal(isLegalTransition("archived", "draft"), false);
});

test("legal edges are accepted", () => {
  assert.equal(isLegalTransition("draft", "editing"), true);
  assert.equal(isLegalTransition("draft", "ready"), true);
  assert.equal(isLegalTransition("editing", "ready"), true);
  assert.equal(isLegalTransition("editing", "draft"), true);
  assert.equal(isLegalTransition("ready", "draft"), true);
  assert.equal(isLegalTransition("ready", "archived"), true);
  assert.equal(isLegalTransition("archived", "ready"), true);
});

test("a status never offers itself as a transition", () => {
  for (const s of Object.keys(STATUS_LABEL) as ProjectStatus[]) {
    assert.equal(legalNextStatuses(s).includes(s), false, `${s} must not offer itself`);
  }
});

test("every status has a human label", () => {
  for (const s of Object.keys(STATUS_LABEL) as ProjectStatus[]) {
    assert.ok(STATUS_LABEL[s].length > 0);
  }
});

// ─── UUID validation must match Postgres, not RFC 9562 ──────────────────────

/**
 * Regression: `z.uuid()` enforces version/variant nibbles; Postgres does not.
 * Seeded rows like f0000000-...-000000000004 are valid `uuid` values but failed
 * zod, so every crew assignment to a seeded member returned "Invalid UUID".
 */
const PG_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

test("the relaxed uuid pattern accepts seeded database ids", () => {
  for (const id of [
    "f0000000-0000-0000-0000-000000000004",
    "5e04512c-1ae8-4746-8dd6-3d64e59f2024",
    "832e4204-1d8b-4c16-83af-28e3422dee2c",
    "B0000000-0000-4000-8000-000000000001",
  ]) {
    assert.equal(PG_UUID.test(id), true, `${id} must be accepted`);
  }
});

test("the relaxed uuid pattern still rejects malformed ids", () => {
  for (const bad of ["", "abc", "not-a-uuid", "f0000000-0000-0000-0000-00000000000", "f0000000-0000-0000-0000-0000000000zz"]) {
    assert.equal(PG_UUID.test(bad), false, `${bad} must be rejected`);
  }
});
