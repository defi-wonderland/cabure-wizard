import { describe, expect, test } from "vitest";
import {
  toProjectDirectoryName,
  validateEndDate,
  validateProjectName,
  validateTargetContributions,
} from "../validate.js";

describe("validate helpers", () => {
  test("validateProjectName trims and accepts valid names", () => {
    expect(validateProjectName("  Privacy Pools v2  ")).toBe(
      "Privacy Pools v2",
    );
  });

  test("validateProjectName rejects empty names", () => {
    expect(() => validateProjectName("   ")).toThrowError(
      "Project name is required.",
    );
  });

  test("validateEndDate accepts blank or proper yyyy-mm-dd", () => {
    expect(validateEndDate("")).toBeNull();
    expect(validateEndDate("2026-03-27")).toBe("2026-03-27");
  });

  test("validateEndDate rejects invalid calendar dates", () => {
    expect(() => validateEndDate("2026-02-30")).toThrowError(
      "End date is not a valid calendar date.",
    );
  });

  test("validateTargetContributions rejects non-positive values", () => {
    expect(() => validateTargetContributions(0)).toThrowError(
      "Target contributions must be a positive integer.",
    );
  });

  test("toProjectDirectoryName normalizes names", () => {
    expect(toProjectDirectoryName("Privacy Pools v2")).toBe("privacy-pools-v2");
  });
});
