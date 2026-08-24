/**
 * Middleware that validates route `:id`-style params are valid UUID v4 strings.
 * Returns 400 with a clean error instead of letting malformed IDs hit Prisma
 * (which throws an ugly internal error).
 *
 * Usage:
 *   router.get("/:id", validateUUID("id"), asyncHandler(...));
 *   router.get("/:consultationId", validateUUID("consultationId"), asyncHandler(...));
 *   // Validate multiple params at once:
 *   router.get("/:userId/posts/:postId", validateUUID("userId", "postId"), asyncHandler(...));
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {...string} paramNames - Route param names to validate (defaults to "id")
 * @returns {import('express').RequestHandler}
 */
export function validateUUID(...paramNames) {
  const names = paramNames.length > 0 ? paramNames : ["id"];

  return (req, _res, next) => {
    for (const name of names) {
      const value = req.params[name];
      if (value && !UUID_RE.test(value)) {
        const err = new Error(`Invalid UUID for parameter "${name}": ${value}`);
        err.statusCode = 400;
        err.code = "INVALID_UUID";
        return next(err);
      }
    }
    next();
  };
}
