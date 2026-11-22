import { ObjectId } from "mongodb";
import {
  getUsersCollection,
  getServicesCollection,
  getBookingsCollection,
} from "../config/db.js";
import { USER_ROLES } from "../utils/constants.js";
import { escapeRegex } from "../utils/regex.js";

/**
 * Formats a user document to guarantee no sensitive data
 * (password hashes, session tokens, internal auth structures) is exposed.
 */
export function formatSafeUser(u) {
  if (!u) return null;
  return {
    id: u._id ? u._id.toString() : u.id,
    _id: u._id,
    name: u.name || "",
    email: u.email || "",
    image: u.image || "",
    role: u.role || "customer",
    isBlocked: Boolean(u.isBlocked),
    businessName: u.businessName || "",
    subscriptionPlan: u.subscriptionPlan || "free",
    subscriptionExpiresAt: u.subscriptionExpiresAt || null,
    createdAt: u.createdAt || null,
  };
}

/**
 * Helper to lookup a user by ID supporting both ObjectId and string formats
 */
export async function findUserById(id) {
  const usersCollection = getUsersCollection();
  if (ObjectId.isValid(id)) {
    return await usersCollection.findOne({
      $or: [{ _id: new ObjectId(id) }, { _id: id }, { id: id }],
    });
  }
  return await usersCollection.findOne({
    $or: [{ _id: id }, { id: id }],
  });
}

/**
 * GET /api/admin/users
 * Role: admin
 * Lists registered platform users with search (name or email), role filtering, and pagination.
 */
export async function getAdminUsers(req, res, next) {
  try {
    const { search, role } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit, 10) || 10));
    const skip = (page - 1) * limit;

    const query = {};

    if (role && Object.values(USER_ROLES).includes(role.toLowerCase().trim())) {
      query.role = role.toLowerCase().trim();
    }

    if (search && search.trim()) {
      const escaped = escapeRegex(search.trim());
      query.$or = [
        { name: { $regex: escaped, $options: "i" } },
        { email: { $regex: escaped, $options: "i" } },
      ];
    }

    const usersCollection = getUsersCollection();
    const total = await usersCollection.countDocuments(query);
    const rawUsers = await usersCollection
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    const users = rawUsers.map(formatSafeUser);

    res.json({
      success: true,
      total,
      page,
      limit,
      users,
      items: users,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/admin/users/:id
 * Role: admin
 * Returns user details along with counts:
 * - for vendors: number of submitted services
 * - for customers: number of bookings submitted
 */
export async function getAdminUserById(req, res, next) {
  try {
    const { id } = req.params;
    const user = await findUserById(id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: `User not found: ${id}`,
      });
    }

    const safeUser = formatSafeUser(user);
    const userIdStr = safeUser.id;

    const servicesCollection = getServicesCollection();
    const bookingsCollection = getBookingsCollection();

    const [serviceCount, bookingCount] = await Promise.all([
      servicesCollection.countDocuments({ vendorId: userIdStr }),
      bookingsCollection.countDocuments({ customerId: userIdStr }),
    ]);

    res.json({
      success: true,
      user: {
        ...safeUser,
        serviceCount,
        bookingCount,
      },
    });
  } catch (error) {
    next(error);
  }
}
