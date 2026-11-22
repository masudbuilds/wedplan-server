import { ObjectId } from "mongodb";
import {
  getBookingsCollection,
  getServicesCollection,
  getUsersCollection,
} from "../config/db.js";
import { BOOKING_STATUS } from "../utils/constants.js";
import { validateBookingStatusUpdate } from "../utils/validators.js";

/**
 * GET /api/vendor/bookings
 * Role: vendor
 * Returns all bookings submitted for the vendor's services.
 * Supports optional ?status= filter.
 * Includes customer name, email, image, and service name/image.
 */
export async function getVendorBookings(req, res, next) {
  try {
    const { status } = req.query;
    const query = { vendorId: req.user.id };

    if (status && status.trim()) {
      const normalizedStatus = status.trim().toLowerCase();
      if (Object.values(BOOKING_STATUS).includes(normalizedStatus)) {
        query.status = normalizedStatus;
      }
    }

    const bookingsCollection = getBookingsCollection();
    const servicesCollection = getServicesCollection();
    const usersCollection = getUsersCollection();

    const rawBookings = await bookingsCollection
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();

    if (rawBookings.length === 0) {
      return res.json({
        success: true,
        count: 0,
        bookings: [],
      });
    }

    const serviceIds = rawBookings
      .map((b) => (ObjectId.isValid(b.serviceId) ? new ObjectId(b.serviceId) : null))
      .filter(Boolean);

    const customerIds = rawBookings.map((b) => b.customerId).filter(Boolean);

    const [services, customers] = await Promise.all([
      serviceIds.length > 0
        ? servicesCollection.find({ _id: { $in: serviceIds } }).toArray()
        : [],
      customerIds.length > 0
        ? usersCollection
            .find(
              {
                $or: customerIds.flatMap((cid) => [
                  { _id: cid },
                  { id: cid },
                  ...(ObjectId.isValid(cid) ? [{ _id: new ObjectId(cid) }] : []),
                ]),
              },
              {
                projection: {
                  _id: 1,
                  id: 1,
                  name: 1,
                  email: 1,
                  image: 1,
                },
              }
            )
            .toArray()
        : [],
    ]);

    const serviceMap = new Map();
    for (const s of services) {
      serviceMap.set(s._id.toString(), s);
    }

    const customerMap = new Map();
    for (const c of customers) {
      const key = c._id?.toString() || c.id;
      const cData = {
        name: c.name || "Customer",
        email: c.email || "",
        image: c.image || "",
      };
      if (c._id) customerMap.set(c._id.toString(), cData);
      if (c.id) customerMap.set(c.id, cData);
    }

    const bookings = rawBookings.map((b) => {
      const service = serviceMap.get(b.serviceId?.toString());
      const customer = customerMap.get(b.customerId?.toString());

      return {
        id: b._id.toString(),
        _id: b._id,
        serviceId: b.serviceId,
        vendorId: b.vendorId,
        customerId: b.customerId,
        eventDate: b.eventDate,
        eventLocation: b.eventLocation,
        message: b.message || "",
        status: b.status,
        createdAt: b.createdAt,
        serviceName: service ? service.serviceName : "Service no longer available",
        serviceImage:
          service && Array.isArray(service.images) && service.images.length > 0
            ? service.images[0]
            : "",
        customer: customer || {
          name: "Customer",
          email: "",
          image: "",
        },
      };
    });

    res.json({
      success: true,
      count: bookings.length,
      bookings,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/vendor/bookings/:id/status
 * Role: vendor
 * Updates a pending booking status to "accepted" or "rejected".
 * Uses atomic updateOne with status: PENDING to prevent race conditions.
 * Once processed, status cannot be changed again.
 */
export async function updateVendorBookingStatus(req, res, next) {
  try {
    const { id } = req.params;
    const validation = validateBookingStatusUpdate(req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: validation.message,
      });
    }

    const bookingId = new ObjectId(id);
    const { status } = req.body;
    const bookingsCollection = getBookingsCollection();

    // Atomic update: only updates if current status is PENDING and belongs to this vendor
    const updateResult = await bookingsCollection.updateOne(
      {
        _id: bookingId,
        vendorId: req.user.id,
        status: BOOKING_STATUS.PENDING,
      },
      {
        $set: {
          status,
          statusUpdatedAt: new Date(),
          updatedAt: new Date(),
        },
      }
    );

    if (updateResult.matchedCount === 1) {
      return res.json({
        success: true,
        message: `Booking request marked as ${status} successfully.`,
      });
    }

    // Determine reason for failure
    const existing = await bookingsCollection.findOne({ _id: bookingId });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Booking not found.",
      });
    }

    if (existing.vendorId !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You are not authorized to update this booking.",
      });
    }

    // Already processed
    return res.status(409).json({
      success: false,
      message: `Booking request cannot be modified because its current status is already ${existing.status}.`,
    });
  } catch (error) {
    next(error);
  }
}
