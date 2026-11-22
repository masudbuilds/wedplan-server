import {
  getUsersCollection,
  getServicesCollection,
  getTransactionsCollection,
} from "../config/db.js";
import { SERVICE_STATUS, USER_ROLES } from "../utils/constants.js";

/**
 * GET /api/admin/stats
 * Role: admin
 * Returns platform-wide overview statistics:
 * - totalUsers: all registered users in the system
 * - totalVendors: registered vendors
 * - totalCustomers: registered customers
 * - totalServices: all submitted wedding services
 * - pendingServices: services awaiting admin moderation
 * - totalTransactions: total Stripe payment records
 */
export async function getAdminStats(req, res, next) {
  try {
    const usersCollection = getUsersCollection();
    const servicesCollection = getServicesCollection();
    const transactionsCollection = getTransactionsCollection();

    const [
      totalUsers,
      totalVendors,
      totalCustomers,
      totalServices,
      pendingServices,
      totalTransactions,
    ] = await Promise.all([
      usersCollection.countDocuments({}),
      usersCollection.countDocuments({ role: USER_ROLES.VENDOR }),
      usersCollection.countDocuments({ role: USER_ROLES.CUSTOMER }),
      servicesCollection.countDocuments({}),
      servicesCollection.countDocuments({ status: SERVICE_STATUS.PENDING }),
      transactionsCollection.countDocuments({}),
    ]);

    res.json({
      success: true,
      stats: {
        totalUsers,
        totalVendors,
        totalCustomers,
        totalServices,
        pendingServices,
        totalTransactions,
      },
    });
  } catch (error) {
    next(error);
  }
}
