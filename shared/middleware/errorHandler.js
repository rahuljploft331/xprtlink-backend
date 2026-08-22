import { Prisma } from "@prisma/client";

export function notFoundHandler(_req, res) {
  res.status(404).json({
    success: false,
    message: "Not found",
    code: "NOT_FOUND",
  });
}

export function errorHandler(err, _req, res, _next) {
  // Zod validation errors → 400
  if (err?.name === "ZodError" || Array.isArray(err?.issues)) {
    const issues = err.issues || err.errors || [];
    const firstIssue = issues[0];
    const field = firstIssue?.path?.join(".");
    const message = firstIssue?.message || "Validation failed";
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
      const field = err.meta?.target?.[0] ?? "field";
      // Always log constraint violations server-side for debugging
      console.error(`[db] Unique constraint violation on '${field}':`, err.message);
      return res.status(409).json({
        success: false,
        message: "A record with this value already exists.",
        code: "CONFLICT",
        field,
      });
    }
    // P2025 — Record not found (e.g. update/delete on missing row)
    if (err.code === "P2025") {
      return res.status(404).json({
        success: false,
        message: "Record not found.",
        code: "NOT_FOUND",
      });
    }
    // P2003 — Foreign key constraint violation
    if (err.code === "P2003") {
      return res.status(400).json({
        success: false,
        message: "Related record not found.",
        code: "FOREIGN_KEY_VIOLATION",
      });
    }
    // All other known Prisma errors → 500 with generic message
    console.error("[db] Prisma error:", err.code, err.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error.",
      code: "DB_ERROR",
    });
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    console.error("[db] Prisma validation error:", err.message);
    return res.status(400).json({
      success: false,
      message: "Invalid query parameters.",
      code: "DB_VALIDATION_ERROR",
    });
  }

  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || "Internal server error";

  // ── H5: ALWAYS log 5xx errors server-side (was previously inverted — only logged in dev) ──
  if (statusCode >= 500) {
    try {
      console.error(`[error] ${statusCode}:`, err);
    } catch {
      console.error(`[error] ${statusCode}:`, String(err));
    }
  }

  res.status(statusCode).json({
    success: false,
    message,
    code: err.code || "INTERNAL_ERROR",
    ...(err.details !== undefined ? { details: err.details } : {}),
    ...(err.field !== undefined ? { field: err.field } : {}),
  });
}
