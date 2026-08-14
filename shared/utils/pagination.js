export function parsePagination(query = {}, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

export function paginatedResult(items = [], { page = 1, limit = 20, total = 0 } = {}) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const hasNextPage = page * limit < total;
  const hasPrevPage = page > 1;

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage,
      hasPrevPage,
    },
  };
}
