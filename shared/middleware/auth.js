import { verifyAccessToken } from "../auth/jwt.js";
import { forbidden, unauthorized } from "../utils/errors.js";

function parseBearer(req) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7);
}

export function authenticate(req, _res, next) {
  try {
    const token = parseBearer(req);
    if (!token) throw unauthorized("Missing or invalid authorization token");
    const payload = verifyAccessToken(token);
    req.auth = {
      userId: payload.sub,
      role: payload.role,
      customerProfileId: payload.customerProfileId ?? null,
      expertProfileId: payload.expertProfileId ?? null,
    };
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError" || err.name === "JsonWebTokenError") {
      next(unauthorized("Invalid or expired token"));
      return;
    }
    next(err);
  }
}

export function optionalAuthenticate(req, _res, next) {
  try {
    const token = parseBearer(req);
    if (!token) {
      req.auth = null;
      return next();
    }
    const payload = verifyAccessToken(token);
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
