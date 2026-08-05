export function notFoundHandler(_req, res) {
  res.status(404).json({
    success: false,
    message: "Not found",
    code: "NOT_FOUND",
  });
}

export function errorHandler(err, _req, res, _next) {
  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || "Internal server error";
  if (process.env.NODE_ENV !== "production" && statusCode >= 500) {
    console.error(err);
  }
  res.status(statusCode).json({
    success: false,
    message,
    code: err.code || "INTERNAL_ERROR",
    ...(err.details !== undefined ? { details: err.details } : {}),
    ...(err.field !== undefined ? { field: err.field } : {}),
  });
}
