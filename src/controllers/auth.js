/**
 * GET /api/me
 * Returns the authenticated user's safe information (id, name, email, role, subscription).
 * Protected by verifyToken middleware.
 */
export async function getCurrentUser(req, res) {
  res.json({
    success: true,
    user: req.user,
  });
}
