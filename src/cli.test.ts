/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test";

/**
 * Tests for CLI argument parsing logic.
 * Note: We test the detection logic directly since parseArguments() calls process.exit on error.
 */

/** Check if string looks like a URL */
function isUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

describe("isUrl", () => {
  test("detects https URLs", () => {
    expect(isUrl("https://api.notion.com/mcp")).toBe(true);
    expect(isUrl("https://example.com")).toBe(true);
  });

  test("detects http URLs", () => {
    expect(isUrl("http://localhost:3000")).toBe(true);
    expect(isUrl("http://example.com/path")).toBe(true);
  });

  test("rejects file paths", () => {
    expect(isUrl("./src/client.ts")).toBe(false);
    expect(isUrl("client.ts")).toBe(false);
    expect(isUrl("/absolute/path.ts")).toBe(false);
  });

  test("rejects edge cases that look like URLs but aren't", () => {
    // This is the edge case we document - files starting with http
    expect(isUrl("http-client.ts")).toBe(false);
    expect(isUrl("https-client.ts")).toBe(false);
  });
});

describe("CLI mode detection", () => {
  /**
   * Simulates parseArguments() mode detection logic.
   * Returns the detected mode kind based on inputs.
   */
  function detectMode(opts: {
    urlFlag?: string;
    positionals?: string[];
    yesFlag?: boolean;
  }): string {
    const { urlFlag, positionals = [], yesFlag } = opts;

    // Priority 1: --url flag
    if (urlFlag) return "url";

    // Priority 2: First positional is URL
    if (positionals[0] && isUrl(positionals[0])) return "url";

    // Priority 3: Positional given but not URL → direct mode
    if (positionals[0]) return "direct";

    // Priority 4: -y flag
    if (yesFlag) return "quick";

    // Priority 5: No args
    return "interactive";
  }

  test("--url flag triggers URL mode", () => {
    expect(detectMode({ urlFlag: "https://api.notion.com/mcp" })).toBe("url");
  });

  test("URL positional triggers URL mode", () => {
    expect(detectMode({ positionals: ["https://api.notion.com/mcp"] })).toBe(
      "url",
    );
    expect(detectMode({ positionals: ["http://localhost:3000"] })).toBe("url");
  });

  test("URL with output file still triggers URL mode", () => {
    expect(
      detectMode({ positionals: ["https://api.notion.com/mcp", "client.ts"] }),
    ).toBe("url");
  });

  test("non-URL positional triggers direct mode", () => {
    expect(detectMode({ positionals: ["client.ts"] })).toBe("direct");
    expect(detectMode({ positionals: ["./src/mcp-client.ts"] })).toBe("direct");
  });

  test("-y flag triggers quick mode", () => {
    expect(detectMode({ yesFlag: true })).toBe("quick");
  });

  test("no args triggers interactive mode", () => {
    expect(detectMode({})).toBe("interactive");
  });

  test("--url flag takes priority over positional URL", () => {
    expect(
      detectMode({
        urlFlag: "https://a.com",
        positionals: ["https://b.com"],
      }),
    ).toBe("url");
  });

  test("edge case: http-client.ts is treated as file, not URL", () => {
    expect(detectMode({ positionals: ["http-client.ts"] })).toBe("direct");
    expect(detectMode({ positionals: ["https-utils.ts"] })).toBe("direct");
  });
});
