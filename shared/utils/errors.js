export class AppError extends Error {
  constructor(message, { statusCode = 400, code = "ERROR", details, field } = {}) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.field = field;
  }
}

export function notFound(message = "Not found", code = "NOT_FOUND") {
  return new AppError(message, { statusCode: 404, code });
}

export function unauthorized(message = "Unauthorized", code = "UNAUTHORIZED") {
  return new AppError(message, { statusCode: 401, code });
}

export function forbidden(message = "Forbidden", code = "FORBIDDEN") {
  return new AppError(message, { statusCode: 403, code });
}

export function badRequest(message = "Bad request", code = "BAD_REQUEST", field) {
  return new AppError(message, { statusCode: 400, code, field });
}

export function conflict(message = "Conflict", code = "CONFLICT") {
  return new AppError(message, { statusCode: 409, code });
}
