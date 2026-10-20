import { describe, expect, it } from "vitest";

import { buildCsv, escapeCsv, csvTimestamp } from "./csv";

describe("escapeCsv", () => {
  it("leaves simple values untouched", () => {
    expect(escapeCsv("hello")).toBe("hello");
    expect(escapeCsv(42)).toBe("42");
    expect(escapeCsv(7n)).toBe("7");
    expect(escapeCsv(null)).toBe("");
  });

  it("quotes commas, quotes and newlines", () => {
    expect(escapeCsv("a,b")).toBe('"a,b"');
    expect(escapeCsv('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsv("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("buildCsv", () => {
  it("joins rows with CRLF", () => {
    expect(buildCsv([["a", "b"], ["1", "2"]])).toBe("a,b\r\n1,2");
  });
});

describe("csvTimestamp", () => {
  it("formats a sortable local timestamp", () => {
    expect(csvTimestamp(new Date(2026, 9, 17, 5, 4, 3))).toBe("20261017-050403");
  });
});
