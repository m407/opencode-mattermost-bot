import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const config = readFileSync(new URL("../../.oxlintrc.json", import.meta.url), "utf8");
const executable = fileURLToPath(new URL("../../node_modules/oxlint/bin/oxlint", import.meta.url));

describe("Oxlint project policy", () => {
  it.each([
    {
      name: "rejects console calls outside the logger",
      file: "src/example.ts",
      source: 'console.log("message");',
      rule: "no-console",
    },
    {
      name: "rejects explicit any even though the rule is a warning",
      file: "src/example.ts",
      source: "export const value: any = 1;",
      rule: "no-explicit-any",
    },
    {
      name: "rejects unused variables",
      file: "src/example.ts",
      source: "const unused = 1; export {};",
      rule: "no-unused-vars",
    },
    {
      name: "rejects unchecked TypeScript suppression",
      file: "src/example.ts",
      source: "// @ts-ignore\nexport const value = 1;",
      rule: "ban-ts-comment",
    },
    {
      name: "allows console calls in the logger",
      file: "src/utils/logger.ts",
      source: 'console.log("message");',
      rule: null,
    },
    {
      name: "allows intentionally unused parameters",
      file: "src/example.ts",
      source: "export function value(_unused: string) { return 1; }",
      rule: null,
    },
  ])("$name", ({ file, source, rule }) => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "opencode-lint-"));
    try {
      writeFileSync(path.join(directory, ".oxlintrc.json"), config);
      const fixture = path.join(directory, file);
      mkdirSync(path.dirname(fixture), { recursive: true });
      writeFileSync(fixture, source);
      const result = spawnSync(
        process.execPath,
        [executable, file, "--max-warnings=0", "--format=json"],
        { cwd: directory, encoding: "utf8" },
      );
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status, result.stdout + result.stderr).toBe(rule ? 1 : 0);
      if (rule) {
        expect(result.stdout).toContain(rule);
      } else {
        expect(JSON.parse(result.stdout).diagnostics).toEqual([]);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
