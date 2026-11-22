import { ObjectId } from "mongodb";
import {
  getBookingsCollection,
  getServicesCollection,
  getUsersCollection,
} from "../config/db.js";
import { SERVICE_STATUS, BOOKING_STATUS } from "../utils/constants.js";
import { validateBookingInput } from "../utils/validators.js";

/**
 * Helper to fetch vendor and service details for customer bookings list.
 * Strips sensitive fields like vendor email.
 */
async function attachCustomerBookingDetails(bookings) {
  if (!bookings || bookings.length === 0) return [];

  const servicesCollection = getServicesCollection();
  const usersCollection = getUsersCollection();

  const serviceIds = bookings
    .map((b) => (ObjectId.isValid(b.serviceId) ? new ObjectId(b.serviceId) : null))
    .filter(Boolean);

  const vendorIds = bookings.map((b) => b.vendorId).filter(Boolean);

  const [services, vendors] = await Promise.all([
    serviceIds.length > 0
      ? servicesCollection.find({ _id: { $in: serviceIds } }).toArray()
      : [],
    vendorIds.length > 0
      ? usersCollection
          .find(
            {
              $or: vendorIds.flatMap((vid) => [
                { _id: vid },
                { id: vid },
                ...(ObjectId.isValid(vid) ? [{ _id: new ObjectId(vid) }] : []),
              ]),
            },
            {
              projection: {
                _id: 1,
                id: 1,
                name: 1,
                businessName: 1,
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

  const vendorMap = new Map();
  for (const v of vendors) {
    const key = v._id?.toString() || v.id;
    const vData = {
      name: v.name || "",
      businessName: v.businessName || v.name || "",
      image: v.image || "",
    };
    if (v._id) vendorMap.set(v._id.toString(), vData);
    if (v.id) vendorMap.set(v.id, vData);
  }

  return bookings.map((b) => {
    const service = serviceMap.get(b.serviceId?.toString());
    const vendor = vendorMap.get(b.vendorId?.toString());

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
      vendor: vendor || {
        name: "WedPlan Partner",
        businessName: "WedPlan Partner",
        image: "",
      },
      vendorName: vendor ? vendor.businessName || vendor.name : "WedPlan Partner",
      vendorImage: vendor ? vendor.image : "",
    };
  });
}

/**
 * POST /api/bookings
 * Role: customer
 * Submits a new booking request for an approved and active service.
 */
export async function createBooking(req, res, next) {
  try {
    const validation = validateBookingInput(req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: validation.message,
      });
    }

    const { serviceId, eventDate, eventLocation, message } = req.body;
    const servicesCollection = getServicesCollection();
    const bookingsCollection = getBookingsCollection();

    const service = await servicesCollection.findOne({
      _id: new ObjectId(serviceId),
    });

    if (!service) {
      return res.status(404).json({
        success: false,
        message: "Wedding service not found.",
      });
    }

    if (service.status !== SERVICE_STATUS.APPROVED || service.isActive !== true) {
      return res.status(400).json({
        success: false,
        message: "This service is currently not available for bookings.",
      });
    }

    // A vendor cannot book their own service
    if (service.vendorId === req.user.id) {
      return res.status(400).json({
        success: false,
        message: "You cannot submit a booking request for your own service.",
      });
    }

    // Check for duplicate active booking for the same customer, service, and date
    const existingActiveBooking = await bookingsCollection.findOne({
      serviceId: new ObjectId(serviceId),
      customerId: req.user.id,
      eventDate,
      status: { $in: [BOOKING_STATUS.PENDING, BOOKING_STATUS.ACCEPTED] },
    });

    if (existingActiveBooking) {
      return res.status(409).json({
        success: false,
        message: `You already have an active booking (${existingActiveBooking.status}) for this service on ${eventDate}.`,
      });
    }

    const newBooking = {
      serviceId: new ObjectId(serviceId),
      vendorId: service.vendorId, // obtained safely from service document
      customerId: req.user.id,    // obtained securely from verified session user
      eventDate,
      eventLocation: eventLocation.trim(),
      message: message ? message.trim() : "",
      status: BOOKING_STATUS.PENDING,
      createdAt: new Date(),
    };

    try {
      const insertResult = await bookingsCollection.insertOne(newBooking);

      res.status(201).json({
        success: true,
        message: "Booking request submitted successfully.",
        booking: {
          id: insertResult.insertedId.toString(),
          _id: insertResult.insertedId,
          serviceName: service.serviceName,
          ...newBooking,
        },
      });
    } catch (insertErr) {
      // Handle MongoDB partial unique index collision (code 11000)
      if (insertErr.code === 11000) {
        return res.status(409).json({
          success: false,
          message: `You already have an active booking for this service on ${eventDate}.`,
        });
      }
      throw insertErr;
    }
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/bookings/my
 * Role: customer
 * Returns all bookings submitted by the logged-in customer, newest first.
 * Safely provides service preview and vendor details (excluding vendor email).
 */
export async function getMyBookings(req, res, next) {
  try {
    const bookingsCollection = getBookingsCollection();
    const rawBookings = await bookingsCollection
      .find({ customerId: req.user.id })
      .sort({ createdAt: -1 })
      .toArray();

    const bookings = await attachCustomerBookingDetails(rawBookings);

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
 * GET /api/bookings/:id
 * Role: customer (who owns it) or vendor (who received it)
 * Returns full booking details with service and participant info.
 */
export async function getBookingById(req, res, next) {
  try {
    const { id } = req.params;
    const bookingsCollection = getBookingsCollection();
    const booking = await bookingsCollection.findOne({ _id: new ObjectId(id) });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    const isCustomerOwner = booking.customerId === req.user.id;
    const isVendorOwner = booking.vendorId === req.user.id;

    if (!isCustomerOwner && !isVendorOwner) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You are not authorized to view this booking",
      });
    }

    const servicesCollection = getServicesCollection();
    const usersCollection = getUsersCollection();

    const [service, customer, vendor] = await Promise.all([
      servicesCollection.findOne({ _id: new ObjectId(booking.serviceId) }),
      usersCollection.findOne(
        {
          $or: [
            { _id: booking.customerId },
            { id: booking.customerId },
            ...(ObjectId.isValid(booking.customerId) ? [{ _id: new ObjectId(booking.customerId) }] : []),
          ],
        },
        { projection: { _id: 1, id: 1, name: 1, email: 1, image: 1 } }
      ),
      usersCollection.findOne(
        {
          $or: [
            { _id: booking.vendorId },
            { id: booking.vendorId },
            ...(ObjectId.isValid(booking.vendorId) ? [{ _id: new ObjectId(booking.vendorId) }] : []),
          ],
        },
        { projection: { _id: 1, id: 1, name: 1, businessName: 1, image: 1 } }
      ),
    ]);

    res.json({
      success: true,
      booking: {
        id: booking._id.toString(),
        _id: booking._id,
        serviceId: booking.serviceId,
        vendorId: booking.vendorId,
        customerId: booking.customerId,
        eventDate: booking.eventDate,
        eventLocation: booking.eventLocation,
        message: booking.message || "",
        status: booking.status,
        createdAt: booking.createdAt,
        service: service
          ? {
              id: service._id.toString(),
              serviceName: service.serviceName,
              category: service.category,
              price: service.price,
              location: service.location,
              images: service.images || [],
            }
          : {
              serviceName: "Service no longer available",
              images: [],
            },
        // Customers only see safe vendor info (no vendor email)
        vendor: vendor
          ? {
              name: vendor.name,
              businessName: vendor.businessName || vendor.name,
              image: vendor.image || "",
            }
          : null,
        // Vendors see customer details so they can contact them
        customer: isVendorOwner && customer
          ? {
              name: customer.name,
              email: customer.email,
              image: customer.image || "",
            }
          : undefined,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/bookings/:id/cancel
 * Role: customer
 * Cancels a pending booking.
 * Uses atomic updateOne with status: PENDING to prevent race conditions.
 */
export async function cancelBooking(req, res, next) {
  try {
    const { id } = req.params;
    const bookingId = new ObjectId(id);
    const bookingsCollection = getBookingsCollection();

    // Atomic update: only updates if customer matches AND status is currently pending
    const updateResult = await bookingsCollection.updateOne(
      {
        _id: bookingId,
        customerId: req.user.id,
        status: BOOKING_STATUS.PENDING,
      },
      {
        $set: {
          status: BOOKING_STATUS.CANCELLED,
          updatedAt: new Date(),
        },
      }
    );

    if (updateResult.matchedCount === 1) {
      return res.json({
        success: true,
        message: "Booking request cancelled successfully.",
      });
    }

    // Determine accurate failure response
    const existing = await bookingsCollection.findOne({ _id: bookingId });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Booking not found.",
      });
    }

    if (existing.customerId !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You can only cancel your own bookings.",
      });
    }

    // Booking has already transitioned to accepted, rejected, or cancelled
    return res.status(409).json({
      success: false,
      message: `Booking cannot be cancelled because it is already ${existing.status}.`,
    });
  } catch (error) {
    next(error);
  }
}
