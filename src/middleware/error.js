export function notFound(req, res, next) {
  res.status(404).json({
    success: false,
    message: `Not Found - ${req.originalUrl}`,
  });
}

export function errorHandler(err, req, res, next) {
  // If the status code was already set to an error code, keep it, otherwise default to 500
  const statusCode =
    res.statusCode && res.statusCode >= 400
      ? res.statusCode
      : err.status || err.statusCode || 500;

  res.status(statusCode).json({
    success: false,
    message: err.message || "Internal server error",
  });
}
