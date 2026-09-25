import { Prisma } from "../generated/prisma/index.js";
import { getMessage } from "../utils/messages.js";
import { logger } from "../lib/logger.js";

const log = logger.child({ module: "errorHandler" });

export function notFoundHandler(_req, res) {
  res.status(404).json({
    success: false,
    message: getMessage("notFound"),
    code: "NOT_FOUND",
  });
}

export function errorHandler(err, _req, res, _next) {
  // Zod validation errors → 400
  if (err?.name === "ZodError" || Array.isArray(err?.issues)) {
    const issues = err.issues || err.errors || [];
    const firstIssue = issues[0];
    const field = firstIssue?.path?.join(".");
    const message = firstIssue?.message || getMessage("validationFailed");
    return res.status(400).json({
      success: false,
      message,
      code: "VALIDATION_ERROR",
      ...(field ? { field } : {}),
      details: issues,
    });
  }

  // ── H5: Map known Prisma errors to clean HTTP responses ──────────────────
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // P2002 — Unique constraint violation
    if (err.code === "P2002") {
      const target = err.meta?.target;
      const targetStr = Array.isArray(target) ? target.join("_") : String(target || "field");
      
      let messageKey = "recordAlreadyExists";
      if (targetStr.toLowerCase().includes("email")) {
        messageKey = "emailAlreadyExists";
      } else if (targetStr.toLowerCase().includes("phone")) {
        messageKey = "phoneAlreadyInUse";
      }

      // Always log constraint violations server-side for debugging
      log.warn({ target: targetStr, err: err.message }, `[db] Unique constraint violation on '${targetStr}'`);
      return res.status(409).json({
        success: false,
        message: getMessage(messageKey),
        code: "CONFLICT",
        field: targetStr,
      });
    }
    // P2025 — Record not found (e.g. update/delete on missing row)
    if (err.code === "P2025") {
      return res.status(404).json({
        success: false,
        message: getMessage("recordNotFound"),
        code: "NOT_FOUND",
      });
    }
    // P2003 — Foreign key constraint violation
    if (err.code === "P2003") {
      return res.status(400).json({
        success: false,
        message: getMessage("relatedRecordNotFound"),
        code: "FOREIGN_KEY_VIOLATION",
      });
    }
    // All other known Prisma errors → 500 with generic message
    log.error({ code: err.code, err: err.message }, "[db] Prisma error");
    return res.status(500).json({
      success: false,
      message: getMessage("internalServerError"),
      code: "DB_ERROR",
    });
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    log.error({ err: err.message }, "[db] Prisma validation error");
    return res.status(400).json({
      success: false,
      message: getMessage("invalidQueryParameters"),
      code: "DB_VALIDATION_ERROR",
    });
  }

  let statusCode = err.statusCode || err.status || 500;
  let message = err.message || getMessage("internalServerError");
  let code = err.code || "INTERNAL_ERROR";

  // ── H5: ALWAYS log 5xx errors server-side (was previously inverted — only logged in dev) ──
  if (statusCode >= 500) {
    try {
      log.error({ statusCode, err }, `[error] ${statusCode}`);
    } catch {
      log.error({ statusCode, err: String(err) }, `[error] ${statusCode}`);
    }
    
    // Sanitize the response for 500s so we don't leak raw 3rd-party error strings/codes (Rule 15)
    message = getMessage("internalServerError");
    code = "INTERNAL_ERROR";
  }

  res.status(statusCode).json({
    success: false,
    message,
    code,
    ...(err.details !== undefined ? { details: err.details } : {}),
    ...(err.field !== undefined ? { field: err.field } : {}),
  });
}
