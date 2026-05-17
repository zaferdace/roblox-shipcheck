import { describe, expect, it } from "vitest";
import { checkVersionCompat } from "../bridge/version-check.js";

describe("checkVersionCompat", () => {
  it("returns 'match' for identical versions", () => {
    expect(checkVersionCompat("0.2.0", "0.2.0")).toBe("match");
  });

  it("returns 'match' for patch drift", () => {
    expect(checkVersionCompat("0.2.0", "0.2.5")).toBe("match");
    expect(checkVersionCompat("0.2.5", "0.2.0")).toBe("match");
  });

  it("returns 'minor_warning' for minor drift on same major", () => {
    expect(checkVersionCompat("0.2.0", "0.3.0")).toBe("minor_warning");
    expect(checkVersionCompat("0.3.0", "0.2.0")).toBe("minor_warning");
  });

  it("returns 'major_mismatch' for major drift", () => {
    expect(checkVersionCompat("0.2.0", "1.0.0")).toBe("major_mismatch");
    expect(checkVersionCompat("1.0.0", "0.2.0")).toBe("major_mismatch");
  });

  it("returns 'invalid' for malformed input", () => {
    expect(checkVersionCompat("0.2.0", "garbage")).toBe("invalid");
    expect(checkVersionCompat("", "0.2.0")).toBe("invalid");
    expect(checkVersionCompat("0.2", "0.2.0")).toBe("invalid");
  });

  it("returns 'invalid' for leading zeros (strict semver)", () => {
    expect(checkVersionCompat("0.2.0", "01.2.0")).toBe("invalid");
    expect(checkVersionCompat("0.2.0", "0.02.0")).toBe("invalid");
    expect(checkVersionCompat("0.2.0", "0.2.01")).toBe("invalid");
  });

  it("returns 'invalid' for v-prefix and whitespace", () => {
    expect(checkVersionCompat("0.2.0", "v0.2.0")).toBe("invalid");
    expect(checkVersionCompat("0.2.0", " 0.2.0")).toBe("invalid");
    expect(checkVersionCompat("0.2.0", "0.2.0 ")).toBe("invalid");
  });
});
