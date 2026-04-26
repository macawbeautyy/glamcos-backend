/**
 * Standardized API response format.
 * Supports BOTH calling conventions:
 *   1. Static:      ApiResponse.success(res, { data, message })
 *   2. Constructor: new ApiResponse(statusCode, data, message)  → res.json(instance)
 */
class ApiResponse {
  /**
   * Constructor form — makes `new ApiResponse(code, data, message)` serialize correctly.
   * Used when you do:  return res.status(201).json(new ApiResponse(201, booking, 'msg'))
   */
  constructor(statusCode = 200, data = null, message = 'Success') {
    this.success = statusCode < 400;
    this.status  = statusCode;
    this.message = message;
    this.data    = data;
  }

  // ── Static helpers ────────────────────────────────────────────────────────

  static success(res, { data = null, message = 'Success', statusCode = 200, meta = null } = {}) {
    const body = { success: true, status: statusCode, message, data };
    if (meta) body.meta = meta;
    return res.status(statusCode).json(body);
  }

  static created(res, { data = null, message = 'Resource created successfully' } = {}) {
    return ApiResponse.success(res, { data, message, statusCode: 201 });
  }

  static paginated(res, { data, page, limit, total, message = 'Success' }) {
    const totalPages = Math.ceil(total / limit);
    return res.status(200).json({
      success: true, status: 200, message, data,
      meta: {
        pagination: { page, limit, total, totalPages,
          hasNextPage: page < totalPages, hasPrevPage: page > 1 },
      },
    });
  }

  static noContent(res) { return res.status(204).send(); }

  static error(res, { message = 'Something went wrong', statusCode = 500, errors = null } = {}) {
    const body = { success: false, status: statusCode, message };
    if (errors) body.errors = errors;
    return res.status(statusCode).json(body);
  }
}

module.exports = ApiResponse;
