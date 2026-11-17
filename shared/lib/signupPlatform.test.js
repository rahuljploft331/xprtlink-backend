import { describe, expect, it } from "vitest";
import { platformFromRequest, platformFromUserAgent } from "./signupPlatform.js";

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

describe("platformFromRequest", () => {
  it("trusts the app header for ios/android only", () => {
    expect(platformFromRequest({ "x-client-platform": "iOS", "user-agent": "Dart/3.5 (dart:io)" })).toBe("ios");
    expect(platformFromRequest({ "x-client-platform": "android" })).toBe("android");
    expect(platformFromRequest({ "x-client-platform": "web", "user-agent": "Dart/3.5 (dart:io)" })).toBe(null);
    expect(platformFromRequest({ "x-client-platform": "hacker" })).toBe(null);
  });
  it("falls back to the browser user agent", () => {
    expect(platformFromRequest({ "user-agent": "Mozilla/5.0 Chrome/130" })).toBe("web");
    expect(platformFromRequest({})).toBe(null);
  });
});
