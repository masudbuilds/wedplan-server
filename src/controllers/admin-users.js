import { ObjectId } from "mongodb";
import {
  getDb,
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

/**
 * PATCH /api/admin/users/:id/block
 * Role: admin
 * Blocks a user. Protects admins from blocking themselves or other admins.
 * Deletes user sessions to log them out immediately.
 */
export async function blockUser(req, res, next) {
  try {
    const { id } = req.params;
    const targetUser = await findUserById(id);

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: `User not found: ${id}`,
      });
    }

    const targetUserIdStr = targetUser._id ? targetUser._id.toString() : targetUser.id;

    // Rule 1: Admin cannot block themselves
    if (targetUserIdStr === req.user.id) {
      return res.status(403).json({
        success: false,
        message: "Action not allowed: Administrators cannot block their own account.",
      });
    }

    // Rule 2: Admin cannot block another admin
    if (targetUser.role === USER_ROLES.ADMIN) {
      return res.status(403).json({
        success: false,
        message: "Action not allowed: Administrators cannot block another administrator account.",
      });
    }

    // Rule 3: User is already blocked
    if (targetUser.isBlocked) {
      return res.status(409).json({
        success: false,
        message: "User is already blocked.",
      });
    }

    const usersCollection = getUsersCollection();
    await usersCollection.updateOne(
      { _id: targetUser._id },
      { $set: { isBlocked: true, updatedAt: new Date() } }
    );

    // Invalidate any active Better Auth sessions for this user
    try {
      const db = getDb();
      await Promise.all([
        db.collection("session").deleteMany({
          $or: [{ userId: targetUserIdStr }, { userId: targetUser._id }],
        }),
        db.collection("sessions").deleteMany({
          $or: [{ userId: targetUserIdStr }, { userId: targetUser._id }],
        }),
      ]);
    } catch {
      // Ignore session collection cleanup errors if collection does not exist yet
    }

    const updatedUser = await findUserById(id);

    res.json({
      success: true,
      message: `User "${targetUser.name || targetUser.email}" has been blocked successfully.`,
      user: formatSafeUser(updatedUser),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/admin/users/:id/unblock
 * Role: admin
 * Unblocks a previously blocked user.
 */
export async function unblockUser(req, res, next) {
  try {
    const { id } = req.params;
    const targetUser = await findUserById(id);

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: `User not found: ${id}`,
      });
    }

    // Rule: User is not blocked
    if (!targetUser.isBlocked) {
      return res.status(409).json({
        success: false,
        message: "User is not currently blocked.",
      });
    }

    const usersCollection = getUsersCollection();
    await usersCollection.updateOne(
      { _id: targetUser._id },
      { $set: { isBlocked: false, updatedAt: new Date() } }
    );

    const updatedUser = await findUserById(id);

    res.json({
      success: true,
      message: `User "${targetUser.name || targetUser.email}" has been unblocked successfully.`,
      user: formatSafeUser(updatedUser),
    });
  } catch (error) {
    next(error);
  }
}
