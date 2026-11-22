import { ObjectId } from "mongodb";
import { getServicesCollection } from "../config/db.js";
import { SERVICE_STATUS, FREE_PLAN_LIMIT } from "../utils/constants.js";
import { isPremium } from "../utils/subscription.js";
import { validateServiceInput, validateAvailabilityUpdate } from "../utils/validators.js";

/**
 * POST /api/vendor/services
 * Role: vendor
 * Creates a new wedding service for the logged-in vendor.
 * Enforces the free-tier limit of max 3 active services.
 */
export async function createService(req, res, next) {
  try {
    const validation = validateServiceInput(req.body, false);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: validation.message,
      });
    }

    const servicesCollection = getServicesCollection();

    // Check free tier limit: active services (isActive: true and status !== "rejected")
    const activeCount = await servicesCollection.countDocuments({
      vendorId: req.user.id,
      isActive: true,
      status: { $ne: SERVICE_STATUS.REJECTED },
    });

    if (!isPremium(req.user) && activeCount >= FREE_PLAN_LIMIT) {
      return res.status(403).json({
        success: false,
        message: `Free plan allows a maximum of ${FREE_PLAN_LIMIT} active services. Please upgrade to Premium to publish unlimited services.`,
      });
    }

    const { serviceName, category, description, price, location, images } = req.body;

    const newService = {
      vendorId: req.user.id,
      serviceName: serviceName.trim(),
      category: category.trim(),
      description: description.trim(),
      price: Number(price),
      location: location.trim(),
      images: images.map((img) => img.trim()),
      status: SERVICE_STATUS.PENDING,
      isActive: true,
      createdAt: new Date(),
    };

    const insertResult = await servicesCollection.insertOne(newService);

    res.status(201).json({
      success: true,
      message: "Service created successfully and is pending admin approval.",
      service: {
        id: insertResult.insertedId.toString(),
        _id: insertResult.insertedId,
        ...newService,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/vendor/services
 * Role: vendor
 * Returns all services belonging to the logged-in vendor (all approval statuses), newest first.
 */
export async function getMyServices(req, res, next) {
  try {
    const servicesCollection = getServicesCollection();
    const services = await servicesCollection
      .find({ vendorId: req.user.id })
      .sort({ createdAt: -1 })
      .toArray();

    res.json({
      success: true,
      count: services.length,
      services: services.map((s) => ({
        ...s,
        id: s._id.toString(),
      })),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/vendor/services/:id
 * Role: vendor
 * Returns a single service owned by the logged-in vendor.
 */
export async function getMyServiceById(req, res, next) {
  try {
    const { id } = req.params;
    const servicesCollection = getServicesCollection();
    const service = await servicesCollection.findOne({ _id: new ObjectId(id) });

    if (!service) {
      return res.status(404).json({
        success: false,
        message: "Service not found",
      });
    }

    if (service.vendorId !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You do not own this service",
      });
    }

    res.json({
      success: true,
      service: {
        ...service,
        id: service._id.toString(),
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/vendor/services/:id
 * Role: vendor
 * Updates editable service fields. Protects vendorId, status, and createdAt from modification.
 */
export async function updateService(req, res, next) {
  try {
    const { id } = req.params;
    const validation = validateServiceInput(req.body, true);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: validation.message,
      });
    }

    const servicesCollection = getServicesCollection();
    const service = await servicesCollection.findOne({ _id: new ObjectId(id) });

    if (!service) {
      return res.status(404).json({
        success: false,
        message: "Service not found",
      });
    }

    if (service.vendorId !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You do not own this service",
      });
    }

    const updates = {};
    const { serviceName, category, description, price, location, images } = req.body;

    if (serviceName !== undefined) updates.serviceName = serviceName.trim();
    if (category !== undefined) updates.category = category.trim();
    if (description !== undefined) updates.description = description.trim();
    if (price !== undefined) updates.price = Number(price);
    if (location !== undefined) updates.location = location.trim();
    if (images !== undefined) updates.images = images.map((img) => img.trim());

    updates.updatedAt = new Date();

    await servicesCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updates }
    );

    const updated = await servicesCollection.findOne({ _id: new ObjectId(id) });

    res.json({
      success: true,
      message: "Service updated successfully",
      service: {
        ...updated,
        id: updated._id.toString(),
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/vendor/services/:id/availability
 * Role: vendor
 * Toggles service availability (isActive: boolean).
 * Turning ON enforces the free-plan limit and rejects already-rejected services.
 */
export async function toggleServiceAvailability(req, res, next) {
  try {
    const { id } = req.params;
    const validation = validateAvailabilityUpdate(req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: validation.message,
      });
    }

    const servicesCollection = getServicesCollection();
    const service = await servicesCollection.findOne({ _id: new ObjectId(id) });

    if (!service) {
      return res.status(404).json({
        success: false,
        message: "Service not found",
      });
    }

    if (service.vendorId !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You do not own this service",
      });
    }

    const { isActive } = req.body;

    // When activating, verify business constraints
    if (isActive) {
      if (service.status === SERVICE_STATUS.REJECTED) {
        return res.status(400).json({
          success: false,
          message: "Rejected services cannot be marked as active.",
        });
      }

      // If service is currently inactive, activating will increase active service count
      if (!service.isActive) {
        const activeCount = await servicesCollection.countDocuments({
          vendorId: req.user.id,
          isActive: true,
          status: { $ne: SERVICE_STATUS.REJECTED },
        });

        if (!isPremium(req.user) && activeCount >= FREE_PLAN_LIMIT) {
          return res.status(403).json({
            success: false,
            message: `Free plan allows a maximum of ${FREE_PLAN_LIMIT} active services. Please upgrade to Premium to activate more services.`,
          });
        }
      }
    }

    await servicesCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          isActive,
          updatedAt: new Date(),
        },
      }
    );

    const updated = await servicesCollection.findOne({ _id: new ObjectId(id) });

    res.json({
      success: true,
      message: `Service availability set to ${isActive ? "active" : "inactive"}.`,
      service: {
        ...updated,
        id: updated._id.toString(),
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/vendor/services/:id
 * Role: vendor
 * Deletes a service owned by the logged-in vendor.
 */
export async function deleteService(req, res, next) {
  try {
    const { id } = req.params;
    const servicesCollection = getServicesCollection();
    const service = await servicesCollection.findOne({ _id: new ObjectId(id) });

    if (!service) {
      return res.status(404).json({
        success: false,
        message: "Service not found",
      });
    }

    if (service.vendorId !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You do not own this service",
      });
    }

    await servicesCollection.deleteOne({ _id: new ObjectId(id) });

    res.json({
      success: true,
      message: "Service deleted successfully",
    });
  } catch (error) {
    next(error);
  }
}
