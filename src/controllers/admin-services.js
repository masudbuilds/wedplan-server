import { ObjectId } from "mongodb";
import {
  getServicesCollection,
  getUsersCollection,
} from "../config/db.js";
import { SERVICE_STATUS, CATEGORIES } from "../utils/constants.js";
import { escapeRegex } from "../utils/regex.js";
import { isValidObjectId } from "../utils/object-id.js";

/**
 * Attaches vendor information (including email, visible only to admins) to service records.
 */
async function attachAdminVendorDetails(services) {
  if (!services || services.length === 0) return [];

  const usersCollection = getUsersCollection();
  const vendorIds = services.map((s) => s.vendorId).filter(Boolean);

  let vendors = [];
  if (vendorIds.length > 0) {
    const conditions = [];
    for (const vid of vendorIds) {
      conditions.push({ _id: vid }, { id: vid });
      if (ObjectId.isValid(vid)) {
        conditions.push({ _id: new ObjectId(vid) });
      }
    }
    vendors = await usersCollection
      .find(
        { $or: conditions },
        {
          projection: {
            _id: 1,
            id: 1,
            name: 1,
            email: 1,
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
      email: v.email || "",
      businessName: v.businessName || v.name || "",
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
      email: "",
      businessName: service.vendorName || "WedPlan Partner",
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
      createdAt: service.createdAt,
      vendor: vendorInfo,
    };
  });
}

/**
 * GET /api/admin/services
 * Role: admin
 * Lists all wedding services with filters for status (pending, approved, rejected),
 * category, search query (serviceName), and pagination.
 */
export async function getAdminServices(req, res, next) {
  try {
    const { search, status, category } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit, 10) || 10));
    const skip = (page - 1) * limit;

    const query = {};

    if (status && Object.values(SERVICE_STATUS).includes(status.toLowerCase().trim())) {
      query.status = status.toLowerCase().trim();
    }

    if (category && category.trim() && category.toLowerCase() !== "all") {
      query.category = {
        $regex: `^${escapeRegex(category.trim())}$`,
        $options: "i",
      };
    }

    if (search && search.trim()) {
      query.serviceName = {
        $regex: escapeRegex(search.trim()),
        $options: "i",
      };
    }

    const servicesCollection = getServicesCollection();
    const total = await servicesCollection.countDocuments(query);
    const rawServices = await servicesCollection
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    const services = await attachAdminVendorDetails(rawServices);

    res.json({
      success: true,
      total,
      page,
      limit,
      services,
      items: services,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/admin/services/:id
 * Role: admin
 * Returns complete service details including vendor email and full metadata.
 */
export async function getAdminServiceById(req, res, next) {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: `Invalid service ID: ${id}`,
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

    const [serviceWithVendor] = await attachAdminVendorDetails([service]);

    res.json({
      success: true,
      service: serviceWithVendor,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/admin/services/:id/status
 * Role: admin
 * Moderates service status ("approved", "rejected", "pending").
 * Returns 409 if status is already set to the requested value.
 */
export async function updateServiceStatus(req, res, next) {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: `Invalid service ID: ${id}`,
      });
    }

    const { status } = req.body;
    const allowed = [
      SERVICE_STATUS.APPROVED,
      SERVICE_STATUS.REJECTED,
      SERVICE_STATUS.PENDING,
    ];

    if (!status || !allowed.includes(status.trim())) {
      return res.status(400).json({
        success: false,
        message: `Status must be one of: "${SERVICE_STATUS.APPROVED}", "${SERVICE_STATUS.REJECTED}", or "${SERVICE_STATUS.PENDING}".`,
      });
    }

    const targetStatus = status.trim();
    const servicesCollection = getServicesCollection();
    const service = await servicesCollection.findOne({ _id: new ObjectId(id) });

    if (!service) {
      return res.status(404).json({
        success: false,
        message: "Service not found",
      });
    }

    // Setting the same status again returns 409 Conflict
    if (service.status === targetStatus) {
      return res.status(409).json({
        success: false,
        message: `Service status is already "${targetStatus}".`,
      });
    }

    await servicesCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          status: targetStatus,
          statusUpdatedAt: new Date(),
          updatedAt: new Date(),
        },
      }
    );

    const updated = await servicesCollection.findOne({ _id: new ObjectId(id) });
    const [updatedWithVendor] = await attachAdminVendorDetails([updated]);

    res.json({
      success: true,
      message: `Service status updated to "${targetStatus}" successfully.`,
      service: updatedWithVendor,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/admin/services/:id
 * Role: admin
 * Deletes an inappropriate service permanently.
 * Existing customer bookings are preserved (displaying "Service no longer available").
 */
export async function deleteAdminService(req, res, next) {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: `Invalid service ID: ${id}`,
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

    await servicesCollection.deleteOne({ _id: new ObjectId(id) });

    res.json({
      success: true,
      message: `Service "${service.serviceName}" has been deleted successfully.`,
    });
  } catch (error) {
    next(error);
  }
}
