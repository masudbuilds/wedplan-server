import { ObjectId } from "mongodb";
import { getServicesCollection } from "../config/db.js";
import { SERVICE_STATUS, FREE_PLAN_LIMIT } from "../utils/constants.js";
import { isPremium } from "../utils/subscription.js";
import { validateServiceInput } from "../utils/validators.js";

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
