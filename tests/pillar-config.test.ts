import test from "node:test";
import assert from "node:assert/strict";
import {
  ALL_PILLARS,
  PILLAR_CONFIG,
  FALLBACK_CONFIG,
  isPillar,
  resolvePillarConfig,
  excludedModules,
  visibleModules,
  type FeatureId,
} from "../src/lib/workspace/pillar-config";
import { formatStorage } from "../src/lib/workspace/folder-metrics";

const ALL_FEATURES: FeatureId[] = [
  "callsheet", "sector", "crew", "gear", "invoice", "rab", "media", "proofing",
];

test("every declared pillar has a complete, self-consistent config", () => {
  for (const pillar of ALL_PILLARS) {
    const config = PILLAR_CONFIG[pillar];
    assert.equal(config.id, pillar, "id must match its key");
    assert.ok(config.label.length > 0, `${pillar} needs a label`);
    assert.ok(config.tag.length > 0, `${pillar} needs a tag`);
    assert.ok(config.modules.length > 0, `${pillar} must enable something`);

    // A module may not be both enabled and excluded.
    for (const id of Object.keys(config.excluded)) {
      assert.equal(
        config.modules.includes(id as FeatureId),
        false,
        `${pillar}: ${id} is both enabled and excluded`
      );
    }
    // No duplicates in the module list.
    assert.equal(new Set(config.modules).size, config.modules.length, `${pillar} has duplicate modules`);
  }
});

test("every pillar either enables or excludes each known module", () => {
  for (const pillar of ALL_PILLARS) {
    const config = PILLAR_CONFIG[pillar];
    const decided = new Set<FeatureId>([
      ...config.modules,
      ...(Object.keys(config.excluded) as FeatureId[]),
    ]);
    for (const feature of ALL_FEATURES) {
      assert.equal(decided.has(feature), true, `${pillar} leaves ${feature} undecided`);
    }
  }
});

test("broadcast excludes proofing; graduation excludes neither proofing nor media", () => {
  const broadcast = PILLAR_CONFIG.BROADCAST_LIVE_STREAMING;
  assert.equal(broadcast.modules.includes("proofing"), false);
  assert.ok(broadcast.excluded.proofing, "broadcast must state WHY proofing is off");

  const graduation = PILLAR_CONFIG.EVENT_GRADUATION_PHOTO;
  assert.equal(graduation.modules.includes("proofing"), true);
  assert.equal(graduation.modules.includes("media"), true);
});

test("all three pillars keep the operational core", () => {
  for (const pillar of ALL_PILLARS) {
    for (const core of ["crew", "gear", "invoice"] as FeatureId[]) {
      assert.equal(PILLAR_CONFIG[pillar].modules.includes(core), true, `${pillar} lost ${core}`);
    }
  }
});

test("isPillar recognises only declared pillars", () => {
  assert.equal(isPillar("BROADCAST_LIVE_STREAMING"), true);
  assert.equal(isPillar("EVENT_GRADUATION_PHOTO"), true);
  assert.equal(isPillar("COMMERCIAL_VIDEO"), true);
  assert.equal(isPillar("WEDDING"), false);
  assert.equal(isPillar(""), false);
  assert.equal(isPillar(null), false);
  assert.equal(isPillar(undefined), false);
  assert.equal(isPillar(42), false);
});

test("an unknown pillar falls back to the FULL matrix, never an empty one", () => {
  for (const raw of ["WEDDING", "", null, undefined, "bogus_value"]) {
    const { config, isFallback } = resolvePillarConfig(raw);
    assert.equal(isFallback, true, `${raw} should report fallback`);
    // Hiding a module due to a data problem would strand the operator.
    assert.deepEqual(visibleModules(config), ALL_FEATURES, `${raw} must expose every module`);
  }
});

test("a known pillar resolves without fallback", () => {
  const { config, isFallback } = resolvePillarConfig("BROADCAST_LIVE_STREAMING");
  assert.equal(isFallback, false);
  assert.equal(config.id, "BROADCAST_LIVE_STREAMING");
});

test("excludedModules names each hidden module with a reason", () => {
  const list = excludedModules(PILLAR_CONFIG.BROADCAST_LIVE_STREAMING);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, "proofing");
  assert.ok(list[0].reason.length > 10, "reason must be a real sentence");

  const graduation = excludedModules(PILLAR_CONFIG.EVENT_GRADUATION_PHOTO);
  assert.ok(graduation.some((e) => e.id === "callsheet"));
});

test("force-enabling a module reveals it and removes it from the excluded list", () => {
  const cfg = PILLAR_CONFIG.BROADCAST_LIVE_STREAMING;
  assert.equal(visibleModules(cfg).includes("proofing"), false);

  const forced = visibleModules(cfg, ["proofing"]);
  assert.equal(forced.includes("proofing"), true);
  assert.equal(excludedModules(cfg, ["proofing"]).length, 0);
});

test("force-enable keeps canonical tab order rather than appending", () => {
  const cfg = PILLAR_CONFIG.BROADCAST_LIVE_STREAMING;
  const withProofing = visibleModules(cfg, ["proofing"]);
  // proofing is last canonically, so the strip is exactly the full order here
  assert.deepEqual(withProofing, ALL_FEATURES);

  const graduation = PILLAR_CONFIG.EVENT_GRADUATION_PHOTO;
  const withCallsheet = visibleModules(graduation, ["callsheet"]);
  assert.equal(withCallsheet[0], "callsheet", "callsheet sorts first, not last");
});

test("formatStorage renders bytes, scales units, and never invents a size", () => {
  assert.equal(formatStorage(null), "—");
  assert.equal(formatStorage(0), "0 B");
  assert.equal(formatStorage(999), "999 B");
  assert.equal(formatStorage(1024), "1.0 KB");
  assert.equal(formatStorage(1024 * 1024 * 2.5), "2.5 MB");
  assert.equal(formatStorage(1024 ** 3 * 12), "12 GB");
  assert.equal(formatStorage(1024 ** 4), "1.0 TB");
});

test("the fallback config is the full matrix", () => {
  assert.deepEqual(visibleModules(FALLBACK_CONFIG), ALL_FEATURES);
  assert.deepEqual(excludedModules(FALLBACK_CONFIG), []);
});
