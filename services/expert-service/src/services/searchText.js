// Free-text expert search helpers: word forms, synonyms, any-word matching and typo correction.

// Trims common suffixes so "plumbing" also finds "plumber" (substring match on the stem).
const STEM_SUFFIXES = ["ists", "ist", "ers", "er", "ing", "ions", "ion", "ed", "es", "s"];
export function stemSearchTerm(term) {
  const t = term.toLowerCase();
  const suffix = STEM_SUFFIXES.find((x) => t.endsWith(x) && t.length - x.length >= 4);
  return suffix ? t.slice(0, -suffix.length) : t;
}

const STOPWORDS = new Set(["a", "an", "the", "for", "in", "near", "me", "and", "of", "to", "with", "my", "i", "need", "on", "at", "or"]);

// Everyday words customers type → words used in our categories/profiles.
// shortcut: hand-kept list in code; move to an admin-editable table if it grows past a few dozen entries.
const SYNONYMS = {
  lawyer: ["legal", "law"], attorney: ["legal", "law"], advocate: ["legal", "law"], law: ["legal"],
  accountant: ["finance", "account"], accounting: ["finance", "account"], cpa: ["finance", "account"],
  tax: ["finance"], taxes: ["finance"], bookkeeper: ["finance"], bookkeeping: ["finance"], financial: ["finance"], money: ["finance"],
  tutor: ["tutoring", "teach"], teacher: ["tutoring", "teach"], teaching: ["tutoring"], lesson: ["tutoring"], lessons: ["tutoring"], homework: ["tutoring"],
  doctor: ["health"], therapist: ["health", "wellness"], therapy: ["health", "wellness"], fitness: ["wellness", "health"], nutrition: ["health", "wellness"], wellbeing: ["wellness"],
  plumbing: ["plumb"], plumber: ["plumb"], pipe: ["plumb"], pipes: ["plumb"], drain: ["plumb"], leak: ["plumb"],
  electrician: ["electric"], electrical: ["electric"], handyman: ["home services"], repair: ["home services"], contractor: ["home services"],
  cleaner: ["clean"], cleaning: ["clean"], maid: ["clean"], housekeeping: ["clean"],
  computer: ["tech"], laptop: ["tech"], it: ["tech"], software: ["tech"], technology: ["tech"], wifi: ["tech"], phone: ["tech"],
};

export function tokenize(q) {
  return String(q || "")
    .toLowerCase()
    .split(/[^a-z0-9&]+/i)
    .filter((w) => w && !STOPWORDS.has(w));
}

/** Substrings that count as a match for one typed word (its stem plus synonyms). */
export function expandWord(word) {
  const w = word.toLowerCase();
  return [...new Set([stemSearchTerm(w), ...(SYNONYMS[w] || [])])];
}

/** Prisma OR covering every field for every term of every word — an expert matches if any word does. */
export function anyWordWhere(wordTerms) {
  const terms = [...new Set(wordTerms.flat())];
  return terms.flatMap((t) => [
    { firstName: { contains: t, mode: "insensitive" } },
    { lastName: { contains: t, mode: "insensitive" } },
    { businessName: { contains: t, mode: "insensitive" } },
    { headline: { contains: t, mode: "insensitive" } },
    { bio: { contains: t, mode: "insensitive" } },
    { title: { contains: t, mode: "insensitive" } },
    { categories: { some: { name: { contains: t, mode: "insensitive" } } } },
  ]);
}

function expertText(e) {
  return [e.firstName, e.lastName, e.businessName, e.headline, e.bio, e.title, ...(e.categories || []).map((c) => c.name)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * Rank score for "plumbing repair" style searches: per typed word, 2 if the word itself
 * (its stem, the first term) matches, 1 if only a synonym does.
 */
export function matchScore(expert, wordTerms) {
  const text = expertText(expert);
  return wordTerms.reduce((score, [stem, ...synonyms]) => {
    if (text.includes(stem)) return score + 2;
    return synonyms.some((t) => text.includes(t)) ? score + 1 : score;
  }, 0);
}

/** Words a typo can be corrected to: names/titles/categories of listed experts plus known search words. */
export function buildVocabulary(experts, categoryNames = []) {
  const vocab = new Set(Object.keys(SYNONYMS));
  const add = (s) => tokenize(s).forEach((w) => w.length >= 3 && !/^\d+$/.test(w) && vocab.add(w));
  categoryNames.forEach(add);
  experts.forEach((e) => [e.firstName, e.lastName, e.businessName, e.headline, e.title].forEach(add));
  return [...vocab];
}

// Optimal string alignment distance (Levenshtein + adjacent swaps), stops early past `max`.
export function editDistance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

/** Closest vocabulary word to a misspelling, or null. Short words allow 1 edit, longer ones 2. */
export function closestWord(word, vocab) {
  if (word.length < 3) return null;
  const max = word.length <= 4 ? 1 : 2;
  let best = null;
  let bestDist = max + 1;
  for (const v of vocab) {
    if (v === word) return null;
    const dist = editDistance(word, v, max);
    if (dist < bestDist || (dist === bestDist && best && Math.abs(v.length - word.length) < Math.abs(best.length - word.length))) {
      best = v;
      bestDist = dist;
    }
  }
  return bestDist <= max ? best : null;
}
