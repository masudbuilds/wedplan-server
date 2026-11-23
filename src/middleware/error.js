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

  // Always log error message and stack trace to server logs (e.g., Vercel / Render)
  // Never log sensitive data like tokens, keys, passwords, or full request bodies
  console.error(`[Error] ${req.method} ${req.originalUrl || req.url}:`, err.message);
  if (err.stack) {
    console.error(err.stack);
  }

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
