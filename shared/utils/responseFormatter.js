export const ResponseFormatter = {
  success(res, { message = "Success", data = null, code, status = 200 } = {}) {
    const body = { success: true, message, data };
    if (code) body.code = code;
    return res.status(status).json(body);
  },

  paginated(
    res,
    {
      message = "Success",
      data = [],
      pagination = { page: 1, limit: 20, total: 0, pages: 0 },
      code,
      status = 200,
    } = {}
  ) {
    const body = { success: true, message, data, pagination };
    if (code) body.code = code;
    return res.status(status).json(body);
  },

  error(
    res,
    {
      message = "Error",
      code = "ERROR",
      details,
      field,
      status = 400,
    } = {}
  ) {
    const body = { success: false, message, code };
    if (details !== undefined) body.details = details;
    if (field !== undefined) body.field = field;
    return res.status(status).json(body);
  },
};
