import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { autocompletePlaces, getPlaceLocation } = await import("./placesService.js");

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const fail = (status, body = {}) => ({ ok: false, status, json: async () => body });
const pred = (placeId, text) => ({ placePrediction: { placeId, text: { text } } });

beforeEach(() => {
  process.env.GOOGLE_MAPS_API_KEY = "test-key";
  globalThis.fetch = vi.fn();
});
afterEach(() => { delete process.env.GOOGLE_MAPS_API_KEY; });

describe("autocompletePlaces", () => {
  it("maps Google suggestions, drops duplicates and caps at 5", async () => {
    fetch.mockResolvedValue(ok({ suggestions: [pred("p1", "JPLoft, Jaipur"), pred("p2", "JPLoft, Denver"), pred("p3", "jploft, jaipur"), pred("p4", "A"), pred("p5", "B"), pred("p6", "C"), pred("p7", "D")] }));
    const r = await autocompletePlaces({ q: "  Jploft " });
    expect(r.map((x) => x.placeId)).toEqual(["p1", "p2", "p4", "p5", "p6"]);
    expect(r[0]).toEqual({ placeId: "p1", name: "JPLoft, Jaipur" });
  });

  it("sends the key in a header (never the URL) plus the trimmed query and session token", async () => {
    fetch.mockResolvedValue(ok({ suggestions: [] }));
    await autocompletePlaces({ q: " Pune ", sessionToken: "abcd1234-ef" });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://places.googleapis.com/v1/places:autocomplete");
    expect(url).not.toContain("test-key");
    expect(init.headers["X-Goog-Api-Key"]).toBe("test-key");
    expect(JSON.parse(init.body)).toEqual({ input: "Pune", sessionToken: "abcd1234-ef" });
  });

  it.each([undefined, "", "ab", "x".repeat(201)])("rejects a bad query (%j) without calling Google", async (q) => {
    await expect(autocompletePlaces({ q })).rejects.toMatchObject({ statusCode: 400, code: "INVALID_QUERY" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a malformed session token", async () => {
    await expect(autocompletePlaces({ q: "Pune", sessionToken: "bad token!" })).rejects.toMatchObject({ code: "INVALID_SESSION_TOKEN" });
  });

  it("503 PLACES_NOT_CONFIGURED when the server has no key (clients fall back)", async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    await expect(autocompletePlaces({ q: "Pune" })).rejects.toMatchObject({ statusCode: 503, code: "PLACES_NOT_CONFIGURED" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("502 when Google rejects the request, and the error never contains the key", async () => {
    fetch.mockResolvedValue(fail(403, { error: { status: "PERMISSION_DENIED" } }));
    const err = await autocompletePlaces({ q: "Pune" }).catch((e) => e);
    expect(err).toMatchObject({ statusCode: 502, code: "PLACES_UPSTREAM_ERROR" });
    expect(JSON.stringify({ m: err.message, d: err.details })).not.toContain("test-key");
  });

  it("502 on a network error or timeout", async () => {
    fetch.mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));
    await expect(autocompletePlaces({ q: "Pune" })).rejects.toMatchObject({ statusCode: 502, code: "PLACES_UPSTREAM_ERROR" });
  });
});

describe("getPlaceLocation", () => {
  it("returns coordinates using a field mask for just the location", async () => {
    fetch.mockResolvedValue(ok({ location: { latitude: 26.9, longitude: 75.8 } }));
    await expect(getPlaceLocation({ placeId: "ChIJabcdef123", sessionToken: "abcd1234-ef" })).resolves.toEqual({ lat: 26.9, lng: 75.8 });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://places.googleapis.com/v1/places/ChIJabcdef123?sessionToken=abcd1234-ef");
    expect(init.headers["X-Goog-FieldMask"]).toBe("location");
  });

  it("rejects a malformed place id before calling Google (no path tricks)", async () => {
    for (const placeId of [undefined, "short", "../../v1/places:autocomplete", "a b c d e f g h"]) {
      await expect(getPlaceLocation({ placeId })).rejects.toMatchObject({ code: "INVALID_PLACE_ID" });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("502 when Google returns no usable location", async () => {
    fetch.mockResolvedValue(ok({}));
    await expect(getPlaceLocation({ placeId: "ChIJabcdef123" })).rejects.toMatchObject({ statusCode: 502 });
  });
});
