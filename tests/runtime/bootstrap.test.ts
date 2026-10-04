import { describe, expect, it } from "vitest";
import dotenv from "dotenv";
import { buildEnvFileContent, validateRuntimeEnvValues } from "../../src/runtime/bootstrap.js";
const valid = {
  MATTERMOST_URL: "https://chat.example.com",
  MATTERMOST_BOT_TOKEN: "secret",
  MATTERMOST_ALLOWED_USER_ID: "a".repeat(26),
  MATTERMOST_CHANNEL_ID: "b".repeat(26),
  OPENCODE_MODEL_PROVIDER: "provider",
  OPENCODE_MODEL_ID: "model",
};
describe("Mattermost setup", () => {
  it("accepts a complete configuration", () => {
    expect(validateRuntimeEnvValues(valid).isValid).toBe(true);
  });
  it.each([
    "MATTERMOST_URL",
    "MATTERMOST_BOT_TOKEN",
    "MATTERMOST_ALLOWED_USER_ID",
    "MATTERMOST_CHANNEL_ID",
  ])("requires %s", (key) => {
    expect(validateRuntimeEnvValues({ ...valid, [key]: "" }).isValid).toBe(false);
  });
  it.each([
    "file:///tmp/test",
    "https://name:password@example.com",
    "https://example.com/?token=x",
  ])("rejects unsafe server URL %s", (url) => {
    expect(validateRuntimeEnvValues({ ...valid, MATTERMOST_URL: url }).isValid).toBe(false);
  });
  it("requires native user and channel IDs", () => {
    expect(validateRuntimeEnvValues({ ...valid, MATTERMOST_ALLOWED_USER_ID: "123" }).isValid).toBe(
      false,
    );
  });
  it("preserves unrelated settings, comments, and quoted secrets", () => {
    const result = buildEnvFileContent("# comment\nCUSTOM=value\nMATTERMOST_BOT_TOKEN=old\n", {
      ...valid,
      MATTERMOST_BOT_TOKEN: "secret # value",
    });
    expect(result).toContain("# comment");
    expect(dotenv.parse(result)).toMatchObject({
      ...valid,
      CUSTOM: "value",
      MATTERMOST_BOT_TOKEN: "secret # value",
    });
  });
});
