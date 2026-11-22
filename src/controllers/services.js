import { ObjectId } from "mongodb";
import { getServicesCollection, getUsersCollection } from "../config/db.js";
import { SERVICE_STATUS } from "../utils/constants.js";
import { escapeRegex } from "../utils/regex.js";
import { isValidObjectId } from "../utils/object-id.js";

/**
 * Attaches sanitized vendor details to service documents.
 * Ensures vendor email and other sensitive fields are never exposed.
 * Gracefully provides defaults when a vendor account does not exist.
 */
async function attachVendorDetails(services) {
  if (!services || services.length === 0) return [];

  const usersCollection = getUsersCollection();
  const vendorIds = services.map((s) => s.vendorId).filter(Boolean);

  const queryConditions = [];
  for (const vid of vendorIds) {
    queryConditions.push({ _id: vid }, { id: vid });
    if (ObjectId.isValid(vid)) {
      queryConditions.push({ _id: new ObjectId(vid) });
    }
  }

  let vendors = [];
  if (queryConditions.length > 0) {
    vendors = await usersCollection
      .find(
        { $or: queryConditions },
        {
          projection: {
            _id: 1,
            id: 1,
            name: 1,
            businessName: 1,
            image: 1,
            subscriptionPlan: 1,
          },
        }
      )
      .toArray();
  }

  const vendorMap = new Map();
  for (const v of vendors) {
    const info = {
      name: v.name || "",
      businessName: v.businessName || "",
      image: v.image || "",
      isPremium: v.subscriptionPlan === "premium",
    };
    if (v._id) vendorMap.set(v._id.toString(), info);
    if (v.id) vendorMap.set(v.id, info);
  }

  return services.map((service) => {
    const vidKey = service.vendorId?.toString();
    const vendorInfo = vendorMap.get(vidKey) || {
      name: service.vendorName || "WedPlan Partner",
      businessName: service.vendorName || "Wedding Specialist",
      image: service.vendorImage || "",
      isPremium: false,
    };

    return {
      id: service._id.toString(),
      _id: service._id,
      vendorId: service.vendorId,
      serviceName: service.serviceName,
      category: service.category,
      description: service.description,
      price: service.price,
      location: service.location,
      images: service.images || [],
      status: service.status,
      isActive: service.isActive !== false,
      isAvailable: service.isActive !== false, // compatibility alias
      createdAt: service.createdAt,
      vendor: vendorInfo,
      vendorName: vendorInfo.businessName || vendorInfo.name,
      vendorImage: vendorInfo.image,
      isPremium: vendorInfo.isPremium,
    };
  });
}

/**
 * GET /api/services
 * Public route to list approved and active wedding services with search, filter, sort, and pagination.
 */
export async function getServices(req, res, next) {
  try {
    const { search, category, location, sort } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 12));
    const skip = (page - 1) * limit;

    // Only approved and active services are publicly visible
    const query = {
      status: SERVICE_STATUS.APPROVED,
      isActive: true,
    };

    // Case-insensitive service name search
    if (search && search.trim()) {
      query.serviceName = {
        $regex: escapeRegex(search.trim()),
        $options: "i",
      };
    }

    // Category filter
    if (category && category.trim() && category.toLowerCase() !== "all") {
      query.category = {
        $regex: `^${escapeRegex(category.trim())}$`,
        $options: "i",
      };
    }

    // Location filter (case-insensitive contains)
    if (location && location.trim()) {
      query.location = {
        $regex: escapeRegex(location.trim()),
        $options: "i",
      };
    }

    // Sorting by price or newest by default
    let sortOption = { createdAt: -1 };
    if (sort === "price_asc" || sort === "price-asc") {
      sortOption = { price: 1 };
    } else if (sort === "price_desc" || sort === "price-desc") {
      sortOption = { price: -1 };
    }

    const servicesCollection = getServicesCollection();
    const total = await servicesCollection.countDocuments(query);
    const rawServices = await servicesCollection
      .find(query)
      .sort(sortOption)
      .skip(skip)
      .limit(limit)
      .toArray();

    const services = await attachVendorDetails(rawServices);

    res.json({
      success: true,
      total,
      page,
      limit,
      services,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/services/featured
 * Public route: returns the latest 6 approved and active services for the homepage banner/sections.
 */
export async function getFeaturedServices(req, res, next) {
  try {
    const servicesCollection = getServicesCollection();
    const rawServices = await servicesCollection
      .find({
        status: SERVICE_STATUS.APPROVED,
        isActive: true,
      })
      .sort({ createdAt: -1 })
      .limit(6)
      .toArray();

    const services = await attachVendorDetails(rawServices);

    res.json({
      success: true,
      services,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/services/:id
 * Public route: returns a single approved and active service with sanitized vendor info.
 * Returns 400 for invalid ID format, 404 if missing or not approved/active.
 */
export async function getServiceById(req, res, next) {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: `Invalid service ID: ${id}`,
      });
    }

    const servicesCollection = getServicesCollection();
    const service = await servicesCollection.findOne({
      _id: new ObjectId(id),
      status: SERVICE_STATUS.APPROVED,
      isActive: true,
    });

    if (!service) {
      return res.status(404).json({
        success: false,
        message: "Service not found or not currently active/approved",
      });
    }

    const [serviceWithVendor] = await attachVendorDetails([service]);

    res.json({
      success: true,
      service: serviceWithVendor,
    });
  } catch (error) {
    next(error);
  }
}

export { attachVendorDetails };
