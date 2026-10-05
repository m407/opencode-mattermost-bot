import { test } from "node:test";
import assert from "node:assert/strict";
import { releaseState } from "./npm-release-state.mjs";

const name = "@m407/opencode-mattermost-bot";
const version = "0.26.3";
const commit = "a".repeat(40);
const stage = { packageName: name, version, tag: "latest", id: "stage-1" };
const check = (status, metadata, stages = []) =>
  releaseState({
    name,
    version,
    tag: "latest",
    fetchRegistry: async () => ({ ok: status === 200, status, json: async () => metadata }),
    listStages: async () => stages,
  });

test("published versions skip staging credentials and retain the original commit", async () => {
  const result = await releaseState({
    name,
    version,
    tag: "latest",
    fetchRegistry: async () => ({
      ok: true,
      json: async () => ({ name, version, gitHead: commit }),
    }),
    listStages: () => {
      throw new Error("must not list stages");
    },
  });
  assert.deepEqual(result, { state: "published", release_commit: commit });
});
test("404 with no matching stage permits staging", async () => {
  assert.deepEqual(await check(404, null, [{ ...stage, version: "0.26.2" }]), { state: "missing" });
});
test("an existing or validating stage is preserved on retries", async () => {
  for (const status of ["staged", "validating"]) {
    assert.deepEqual(await check(404, null, [{ ...stage, status }]), {
      state: "pending",
      stage_id: "stage-1",
    });
  }
});
test("registry access and server errors never permit staging", async () => {
  for (const status of [401, 403, 429, 500])
    await assert.rejects(check(status), /refusing to stage/);
});
test("malformed metadata, missing commit and malformed stage responses fail closed", async () => {
  await assert.rejects(check(200, { name: "other", version, gitHead: commit }), /metadata/);
  await assert.rejects(check(200, { name, version }), /gitHead/);
  await assert.rejects(check(404, null, {}), /stage list/);
  await assert.rejects(check(404, null, [null]), /stage list/);
});
test("an immutable tag mismatch and duplicate stages require intervention", async () => {
  await assert.rejects(check(404, null, [{ ...stage, tag: "next" }]), /immutable/);
  await assert.rejects(check(404, null, [stage, stage]), /Multiple/);
});
