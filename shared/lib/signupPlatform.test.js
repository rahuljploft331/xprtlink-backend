import { describe, expect, it } from "vitest";
import { platformFromUserAgent } from "./signupPlatform.js";

describe("platformFromUserAgent", () => {
  it("tags browsers as web", () => {
    expect(platformFromUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130 Safari/537.36")).toBe("web");
    expect(platformFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1")).toBe("web");
  });
  it("leaves the app and unknown clients untagged", () => {
    expect(platformFromUserAgent("Dart/3.5 (dart:io)")).toBe(null);
    expect(platformFromUserAgent("")).toBe(null);
    expect(platformFromUserAgent(undefined)).toBe(null);
    expect(platformFromUserAgent("PostmanRuntime/7.39")).toBe(null);
  });
});
