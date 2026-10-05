import { appendFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export async function releaseState({ name, version, tag, fetchRegistry, listStages }) {
  const response = await fetchRegistry(
    `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
  );
  if (response.ok) {
    const metadata = await response.json();
    if (
      metadata.name !== name ||
      metadata.version !== version ||
      !/^[a-f0-9]{40}$/.test(metadata.gitHead ?? "")
    ) {
      throw new Error(
        "Published metadata must match the package/version and include a valid gitHead",
      );
    }
    return { state: "published", release_commit: metadata.gitHead };
  }
  if (response.status !== 404) {
    throw new Error(`npm registry returned HTTP ${response.status}; refusing to stage`);
  }
  const items = await listStages(name);
  if (
    !Array.isArray(items) ||
    items.some(
      (item) =>
        !item ||
        typeof item.packageName !== "string" ||
        typeof item.version !== "string" ||
        typeof item.id !== "string" ||
        !/^[A-Za-z0-9-]+$/.test(item.id),
    )
  ) {
    throw new Error("Unexpected npm stage list response");
  }
  const matches = items.filter((item) => item.packageName === name && item.version === version);
  if (matches.length > 1) throw new Error("Multiple stages found for the same version");
  if (matches.length === 0) return { state: "missing" };
  if (matches[0].tag !== tag) {
    throw new Error(
      "Pending stage has a different immutable dist-tag; review and reject it before restaging",
    );
  }
  return { state: "pending", stage_id: matches[0].id };
}

async function main() {
  const { name, version } = JSON.parse(readFileSync("package.json", "utf8"));
  const tag = process.env.NPM_DIST_TAG;
  if (!tag) throw new Error("NPM_DIST_TAG is required");
  const result = await releaseState({
    name,
    version,
    tag,
    fetchRegistry: (url) => fetch(url, { signal: AbortSignal.timeout(30_000) }),
    listStages: (packageName) => {
      if (!process.env.NODE_AUTH_TOKEN)
        throw new Error("NPM_TOKEN secret is required to inspect and create npm stages");
      const child = spawnSync("npm", ["stage", "list", packageName, "--json"], {
        encoding: "utf8",
        timeout: 60_000,
      });
      // Do not forward registry/CLI output that might include authentication details.
      if (child.error || child.status !== 0)
        throw new Error(
          "npm stage list failed; check token scope, permissions, expiry and npm >=11.15.0",
        );
      return JSON.parse(child.stdout);
    },
  });
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(result)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(""),
    );
  }
  const message = `${name}@${version}: ${result.state}${result.stage_id ? ` (stage ${result.stage_id})` : ""}`;
  process.stdout.write(`${message}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `${message}\n\n${result.state === "pending" ? "Review the existing stage on npmjs with 2FA. Rerun Publish on main after approval. Existing staged contents are not replaced.\n" : ""}`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
