const LOWEST_SUPPORTED_MAJOR = 22;

/** Minimum supported releases; keep aligned with package.json engines. */
const MINIMUM_MINOR_BY_MAJOR = new Map<number, number>([
  [22, 14],
  [23, 6],
]);

const SUPPORTED_NODE_VERSIONS = "22.14+, 23.6+, or 24+";

/**
 * Returns an error message when the running Node.js is too old, otherwise null.
 */
export function getUnsupportedNodeVersionMessage(
  version: string = process.versions.node,
): string | null {
  const [rawMajor, rawMinor] = version.split(".");
  const major = Number.parseInt(rawMajor ?? "", 10);
  const minor = Number.parseInt(rawMinor ?? "", 10);

  if (!Number.isInteger(major) || !Number.isInteger(minor)) {
    return null;
  }

  if (major >= LOWEST_SUPPORTED_MAJOR) {
    const minimumMinor = MINIMUM_MINOR_BY_MAJOR.get(major);

    if (minimumMinor === undefined || minor >= minimumMinor) {
      return null;
    }
  }

  return [
    `OpenCode Mattermost Bot requires Node.js ${SUPPORTED_NODE_VERSIONS}, but the current version is v${version}.`,
    "Update Node.js and try again: https://nodejs.org",
  ].join("\n");
}
