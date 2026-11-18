import { describe, expect, it } from "vitest";
import { anyWordWhere, buildVocabulary, closestWord, editDistance, expandWord, matchedWordCount, stemSearchTerm, tokenize } from "./searchText.js";

describe("stemSearchTerm", () => {
  it("maps word forms to one stem", () => {
    expect(stemSearchTerm("plumbing")).toBe("plumb");
    expect(stemSearchTerm("plumber")).toBe("plumb");
    expect(stemSearchTerm("plumbers")).toBe("plumb");
    expect(stemSearchTerm("Vishal")).toBe("vishal");
    expect(stemSearchTerm("tax")).toBe("tax");
  });
});

describe("tokenize / expandWord", () => {
  it("drops filler words and punctuation", () => {
    expect(tokenize("I need a Plumber, near me!")).toEqual(["plumber"]);
    expect(tokenize("plumbing repair")).toEqual(["plumbing", "repair"]);
  });
  it("adds synonyms", () => {
    expect(expandWord("lawyer")).toEqual(["lawy", "legal", "law"]);
    expect(expandWord("Plumbing")).toEqual(["plumb"]);
  });
  it("builds an any-word OR over every field", () => {
    const or = anyWordWhere([["plumb"], ["repair", "home services"]]);
    expect(or).toHaveLength(3 * 7);
    expect(or[0]).toEqual({ firstName: { contains: "plumb", mode: "insensitive" } });
  });
});

describe("matchedWordCount", () => {
  const kim = { firstName: "Kim", lastName: "John", title: "Plumber", categories: [{ name: "Home Services" }] };
  it("counts how many typed words an expert matches", () => {
    expect(matchedWordCount(kim, [expandWord("plumbing"), expandWord("repair")])).toBe(2);
    expect(matchedWordCount(kim, [expandWord("plumbing"), expandWord("tax")])).toBe(1);
    expect(matchedWordCount(kim, [expandWord("lawyer")])).toBe(0);
  });
});

describe("typo correction", () => {
  const vocab = buildVocabulary([{ firstName: "Kim", lastName: "John", title: "Senior Plumber" }], ["Legal", "Tutoring", "Home Services"]);
  it("measures edits, including swapped letters", () => {
    expect(editDistance("plumbr", "plumber")).toBe(1);
    expect(editDistance("plubmer", "plumber")).toBe(1);
    expect(editDistance("abc", "xyzxyz")).toBe(3);
  });
  it("suggests the closest known word", () => {
    expect(closestWord("plumbr", vocab)).toBe("plumber");
    expect(closestWord("plumbin", vocab)).toBe("plumbing");
    expect(closestWord("tutorng", vocab)).toBe("tutoring");
    expect(closestWord("leagl", vocab)).toBe("legal");
  });
  it("leaves exact words and nonsense alone", () => {
    expect(closestWord("plumber", vocab)).toBe(null);
    expect(closestWord("zzzqq", vocab)).toBe(null);
    expect(closestWord("ab", vocab)).toBe(null);
  });
});
