import { ObjectId } from "mongodb";
import {
  getBookingsCollection,
  getServicesCollection,
} from "../config/db.js";
import { SERVICE_STATUS, BOOKING_STATUS } from "../utils/constants.js";
import { validateBookingInput } from "../utils/validators.js";

/**
 * POST /api/bookings
 * Role: customer
 * Submits a new booking request for an approved and active service.
 * Enforces:
 * - Service availability check (approved & active)
 * - Self-booking prevention (cannot book own service)
 * - Duplicate active booking rejection (same customer + service + date with pending or accepted)
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
