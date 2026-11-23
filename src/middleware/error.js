export function notFound(req, res, next) {
  res.status(404).json({
    success: false,
    message: `Not Found - ${req.originalUrl}`,
  });
}

export function errorHandler(err, req, res, next) {
  const statusCode =
    res.statusCode && res.statusCode >= 400
      ? res.statusCode
      : err.status || err.statusCode || 500;

  // Protect internal error details and driver messages in production mode
  const isProd = process.env.NODE_ENV === "production";
  const message =
    statusCode === 500 && isProd
      ? "Internal server error"
      : err.message || "Internal server error";

  res.status(statusCode).json({
    success: false,
    message,
  });
}
