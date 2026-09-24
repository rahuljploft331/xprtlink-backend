import { verifyAccessToken } from "../auth/jwt.js";
import { forbidden, unauthorized } from "../utils/errors.js";
import { getDb } from "../db/index.js";

/**
 * Extract a Bearer token from the request.
 * Checks (in order):
 *   1. Authorization: Bearer <token>  header  (all normal API calls)
 *   2. ?token=<token>                 query   (SSE / EventSource — browsers can't send headers)
 */
function parseBearer(req) {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  if (req.query?.token) return req.query.token;
  return null;
}

const userStatusCache = new Map();
const CACHE_TTL_MS = 60000;

async function checkUserStatus(userId) {
  const now = Date.now();
  if (userStatusCache.has(userId)) {
    const { status, timestamp } = userStatusCache.get(userId);
    if (now - timestamp < CACHE_TTL_MS) {
      return status;
    }
  }

  const db = getDb();
  const user = await db.user.findUnique({ where: { id: userId }, select: { status: true } });
  const status = user ? user.status : null;
  
  userStatusCache.set(userId, { status, timestamp: now });
  return status;
}

export async function authenticate(req, _res, next) {
  try {
    const token = parseBearer(req);
    if (!token) throw unauthorized("Missing or invalid authorization token");
    const payload = verifyAccessToken(token);

    const status = await checkUserStatus(payload.sub);
    if (status !== "active") {
      throw unauthorized("User account is disabled or suspended");
    }

    req.auth = {
      userId: payload.sub,
      role: payload.role,
      customerProfileId: payload.customerProfileId ?? null,
      expertProfileId: payload.expertProfileId ?? null,
    };
    next();
  } catch (err) {
    if (err?.name === "TokenExpiredError" || err?.name === "JsonWebTokenError") {
      return next(unauthorized("Invalid or expired token"));
    }
    if (err?.statusCode === 401) {
      return next(err);
    }
    console.error("[Auth] Unexpected error during authentication:", err);
    next(err);
  }
}

export async function optionalAuthenticate(req, _res, next) {
  try {
    const token = parseBearer(req);
    if (!token) {
      req.auth = null;
      return next();
    }
    const payload = verifyAccessToken(token);
    const status = await checkUserStatus(payload.sub);
    
    if (status !== "active") {
      req.auth = null;
      return next();
    }

    req.auth = {
      userId: payload.sub,
      role: payload.role,
      customerProfileId: payload.customerProfileId ?? null,
      expertProfileId: payload.expertProfileId ?? null,
    };
    next();
  } catch {
    req.auth = null;
    next();
  }
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.auth) return next(unauthorized());
    if (!roles.includes(req.auth.role)) {
      return next(forbidden(`Requires role: ${roles.join(" or ")}`));
    }
    next();
  };
}
