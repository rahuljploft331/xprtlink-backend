import { describe, expect, it } from "vitest";
import { redactUrl } from "./redactUrl.js";

const JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ4In0.sig";

describe("redactUrl", () => {
  it("masks the token on the admin SSE stream URL (the case seen in the PM2 logs)", () => {
    expect(redactUrl(`/api/v1/admin/events?token=${JWT}`)).toBe("/api/v1/admin/events?token=[REDACTED]");
  });

  it("keeps the path and the other params, masking only secret values", () => {
    expect(redactUrl(`/x?page=2&token=${JWT}&limit=10`)).toBe("/x?page=2&token=[REDACTED]&limit=10");
    expect(redactUrl("/x?access_token=a&refresh_token=b&id_token=c&password=d&otp=123456&api_key=k")).toBe(
      "/x?access_token=[REDACTED]&refresh_token=[REDACTED]&id_token=[REDACTED]&password=[REDACTED]&otp=[REDACTED]&api_key=[REDACTED]"
    );
  });

  it("is case-insensitive and understands encoded names", () => {
    expect(redactUrl("/x?Token=abc&ACCESSTOKEN=def")).toBe("/x?Token=[REDACTED]&ACCESSTOKEN=[REDACTED]");
    expect(redactUrl("/x?to%6Ben=abc")).toBe("/x?to%6Ben=[REDACTED]");
  });

  it("leaves harmless params alone, including look-alikes", () => {
    expect(redactUrl("/places/autocomplete?q=Jploft&sessionToken=abcd1234-ef")).toBe("/places/autocomplete?q=Jploft&sessionToken=abcd1234-ef");
    expect(redactUrl("/x?tokens=1&mytoken=2")).toBe("/x?tokens=1&mytoken=2");
  });

  it("returns URLs without a query (and non-strings) unchanged", () => {
    expect(redactUrl("/api/v1/health")).toBe("/api/v1/health");
    expect(redactUrl("/x?")).toBe("/x?");
    expect(redactUrl("/x?flag")).toBe("/x?flag");
    expect(redactUrl(undefined)).toBeUndefined();
    expect(redactUrl(null)).toBeNull();
  });

  it("keeps a #fragment and handles repeated and empty values", () => {
    expect(redactUrl("/x?token=abc#top")).toBe("/x?token=[REDACTED]#top");
    expect(redactUrl("/x?token=a&token=b")).toBe("/x?token=[REDACTED]&token=[REDACTED]");
    expect(redactUrl("/x?token=")).toBe("/x?token=[REDACTED]");
  });

  it("never leaks the secret anywhere in the output", () => {
    expect(redactUrl(`/api/v1/admin/events?token=${JWT}&x=1`)).not.toContain("eyJ");
  });
});
