export function notFoundHandler(_req, res) {
  res.status(404).json({
    success: false,
    message: "Not found",
    code: "NOT_FOUND",
  });
}

export function errorHandler(err, _req, res, _next) {
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

  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || "Internal server error";
  if (process.env.NODE_ENV !== "production" && statusCode >= 500) {
    try {
      console.error(err);
    } catch {
      console.error(String(err));
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
