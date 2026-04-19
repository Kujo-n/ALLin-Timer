import { describe, expect, it } from "vitest";

import { sanitizeRedirect } from "./redirect";

describe("sanitizeRedirect", () => {
  it("allows a simple relative path", () => {
    expect(sanitizeRedirect("/join/abc")).toBe("/join/abc");
  });

  it("falls back on null / empty", () => {
    expect(sanitizeRedirect(null)).toBe("/tournaments");
    expect(sanitizeRedirect("")).toBe("/tournaments");
  });

  it("rejects absolute URLs", () => {
    expect(sanitizeRedirect("https://evil.com/x")).toBe("/tournaments");
    expect(sanitizeRedirect("http://evil.com")).toBe("/tournaments");
  });

  it("rejects protocol-relative redirect (//)", () => {
    expect(sanitizeRedirect("//evil.com")).toBe("/tournaments");
  });

  it("rejects percent-encoded protocol-relative (%2F%2Fevil.com)", () => {
    expect(sanitizeRedirect("/%2F%2Fevil.com")).toBe("/tournaments");
    expect(sanitizeRedirect("%2F%2Fevil.com")).toBe("/tournaments");
  });

  it("rejects backslash-based bypass", () => {
    expect(sanitizeRedirect("/\\evil.com")).toBe("/tournaments");
  });

  it("rejects malformed percent-encoding", () => {
    expect(sanitizeRedirect("/%ZZ")).toBe("/tournaments");
  });

  it("respects custom fallback", () => {
    expect(sanitizeRedirect(null, "/home")).toBe("/home");
  });
});
