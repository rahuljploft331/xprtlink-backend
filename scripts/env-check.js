/**
 * Soft env check for scaffold. Does not require DB vars.
 */
const recommended = ["NODE_ENV", "JWT_SECRET", "SERVICE_SECRET", "CORS_ORIGIN"];

let missing = 0;
for (const key of recommended) {
  if (!process.env[key]) {
    console.warn(`[env:check] missing recommended: ${key}`);
    missing += 1;
  }
}

if (missing === 0) {
  console.log("[env:check] recommended vars present");
} else {
  console.log(`[env:check] ${missing} recommended var(s) missing (non-fatal for scaffold)`);
}

console.log("[env:check] DB / Redis not required yet — deferred");
