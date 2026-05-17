export type VersionCompatResult = "match" | "minor_warning" | "major_mismatch" | "invalid";

// Strict semver MAJOR.MINOR.PATCH per https://semver.org §2:
// leading zeros forbidden ("01.2.0" → invalid).
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

function parse(version: string): [number, number, number] | null {
  const match = SEMVER_RE.exec(version);
  if (!match) return null;
  // When SEMVER_RE matches, groups 1–3 are always present (non-optional capture groups).
  // `?? "0"` satisfies noUncheckedIndexedAccess without changing runtime behavior.
  return [Number(match[1] ?? "0"), Number(match[2] ?? "0"), Number(match[3] ?? "0")];
}

export function checkVersionCompat(
  serverVersion: string,
  pluginVersion: string,
): VersionCompatResult {
  const server = parse(serverVersion);
  const plugin = parse(pluginVersion);
  if (!server || !plugin) return "invalid";
  if (server[0] !== plugin[0]) return "major_mismatch";
  if (server[1] !== plugin[1]) return "minor_warning";
  return "match";
}
