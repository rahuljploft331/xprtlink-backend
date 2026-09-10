import { getMessage } from './messages.js';

export class AppError extends Error {
  constructor(message, { statusCode = 400, code = "ERROR", details, field } = {}) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.field = field;
  }
}

export function notFound(messageKey = "notFound", code = "NOT_FOUND") {
  return new AppError(getMessage(messageKey), { statusCode: 404, code });
}

export function unauthorized(messageKey = "invalidCredentials", code = "UNAUTHORIZED") {
  return new AppError(getMessage(messageKey), { statusCode: 401, code });
}

export function forbidden(messageKey = "notFound", code = "FORBIDDEN", field, params) {
  return new AppError(getMessage(messageKey, params), { statusCode: 403, code, field });
}

export function badRequest(messageKey = "notFound", code = "BAD_REQUEST", field, params) {
  return new AppError(getMessage(messageKey, params), { statusCode: 400, code, field });
}

export function conflict(messageKey = "recordAlreadyExists", code = "CONFLICT") {
  return new AppError(getMessage(messageKey), { statusCode: 409, code });
}
