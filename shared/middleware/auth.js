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

async function checkUserStatus(userId, role) {
  const now = Date.now();
  if (userStatusCache.has(userId)) {
    const { status, timestamp } = userStatusCache.get(userId);
    if (now - timestamp < CACHE_TTL_MS) {
      return status;
    }
  }

  const db = getDb();
  let status = null;

  if (role === 'super_admin' || role === 'subadmin') {
    console.log('ADMIN DB FIND', userId, process.env.DATABASE_URL);
    const admin = await db.adminUser.findUnique({ where: { id: userId }, select: { status: true } });
    status = admin ? admin.status : null;
  } else {
    const user = await db.user.findUnique({ where: { id: userId }, select: { status: true } });
    status = user ? user.status : null;
  }
  
  console.log('CHECKED STATUS FOR', userId, role, 'RESULT:', status);
  userStatusCache.set(userId, { status, timestamp: now });
  return status;
}

export async function authenticate(req, _res, next) {
  try {
    const token = parseBearer(req);
    if (!token) throw unauthorized("missingOrInvalidAuthToken");
    const payload = verifyAccessToken(token);

    const status = await checkUserStatus(payload.sub, payload.role);
    if (status !== "active") {
      throw unauthorized("accountDisabledFriendly");
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
      return next(unauthorized("invalidOrExpiredToken"));
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
    const status = await checkUserStatus(payload.sub, payload.role);
    
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
    if (!req.auth) return next(unauthorized("missingOrInvalidAuthToken"));
    if (!roles.includes(req.auth.role)) {
      return next(forbidden("insufficientRole"));
    }
    next();
  };
}
