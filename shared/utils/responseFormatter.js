export const ResponseFormatter = {
  success(res, { message = "Success", data = null, code, status = 200, meta } = {}) {
    const body = { success: true, message, data };
    if (meta !== undefined) body.meta = meta;
    if (code) body.code = code;
    return res.status(status).json(body);
  },

  paginated(
    res,
    {
      message = "Success",
      items = [],
      page,
      limit,
      total,
      pagination,
      stats,
      code,
      meta,
      status = 200,
    } = {}
  ) {
    const pPage = page ?? pagination?.page ?? 1;
    const pLimit = limit ?? pagination?.limit ?? 20;
    const pTotal = total ?? pagination?.total ?? 0;

    const data = { items, page: pPage, limit: pLimit, total: pTotal };
    if (stats !== undefined) data.stats = stats;
    const body = {
      success: true,
      message,
      data,
    };
    if (meta !== undefined) body.meta = meta;
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
