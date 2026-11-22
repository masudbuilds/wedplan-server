import {
  getServicesCollection,
  getBookingsCollection,
} from "../config/db.js";
import { SERVICE_STATUS, BOOKING_STATUS } from "../utils/constants.js";
import { isPremium } from "../utils/subscription.js";

/**
 * GET /api/vendor/stats
 * Role: vendor
 * Returns overview statistics for the vendor dashboard:
 * - totalServices: all services submitted by this vendor
 * - activeServices: published services where isActive is true and status !== "rejected"
 * - pendingBookings: booking requests awaiting review
 * - acceptedBookings: confirmed bookings
 * - subscription details: plan, isPremium boolean, and expiry
 */
export async function getVendorStats(req, res, next) {
  try {
    const servicesCollection = getServicesCollection();
    const bookingsCollection = getBookingsCollection();

    const [
      totalServices,
      activeServices,
      pendingBookings,
      acceptedBookings,
    ] = await Promise.all([
      servicesCollection.countDocuments({ vendorId: req.user.id }),
      servicesCollection.countDocuments({
        vendorId: req.user.id,
        isActive: true,
        status: { $ne: SERVICE_STATUS.REJECTED },
      }),
      bookingsCollection.countDocuments({
        vendorId: req.user.id,
        status: BOOKING_STATUS.PENDING,
      }),
      bookingsCollection.countDocuments({
        vendorId: req.user.id,
        status: BOOKING_STATUS.ACCEPTED,
      }),
    ]);

    res.json({
      success: true,
      stats: {
        totalServices,
        activeServices,
        pendingBookings,
        acceptedBookings,
        subscriptionPlan: req.user.subscriptionPlan || "free",
        isPremium: isPremium(req.user),
        subscriptionExpiresAt: req.user.subscriptionExpiresAt || null,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/customer/stats
 * Role: customer
 * Returns overview statistics for the customer dashboard:
 * - totalBookings: all booking requests submitted by the customer
 * - pending: count of pending bookings
 * - accepted: count of accepted bookings
 * - rejected: count of rejected bookings
 * - cancelled: count of cancelled bookings
 */
export async function getCustomerStats(req, res, next) {
  try {
    const bookingsCollection = getBookingsCollection();

    const [
      totalBookings,
      pending,
      accepted,
      rejected,
      cancelled,
    ] = await Promise.all([
      bookingsCollection.countDocuments({ customerId: req.user.id }),
      bookingsCollection.countDocuments({
        customerId: req.user.id,
        status: BOOKING_STATUS.PENDING,
      }),
      bookingsCollection.countDocuments({
        customerId: req.user.id,
        status: BOOKING_STATUS.ACCEPTED,
      }),
      bookingsCollection.countDocuments({
        customerId: req.user.id,
        status: BOOKING_STATUS.REJECTED,
      }),
      bookingsCollection.countDocuments({
        customerId: req.user.id,
        status: BOOKING_STATUS.CANCELLED,
      }),
    ]);

    res.json({
      success: true,
      stats: {
        totalBookings,
        pending,
        accepted,
        rejected,
        cancelled,
      },
    });
  } catch (error) {
    next(error);
  }
}
