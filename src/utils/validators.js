import { CATEGORIES, BOOKING_STATUS } from "./constants.js";
import { isValidObjectId } from "./object-id.js";

/**
 * Validates service creation and update inputs.
 * For updates (isUpdate = true), fields are optional but must be valid if provided.
 */
export function validateServiceInput(body = {}, isUpdate = false) {
  const { serviceName, category, description, price, location, images } = body;

  if (isUpdate) {
    const hasAnyField =
      serviceName !== undefined ||
      category !== undefined ||
      description !== undefined ||
      price !== undefined ||
      location !== undefined ||
      images !== undefined;

    if (!hasAnyField) {
      return {
        isValid: false,
        message: "At least one valid field must be provided for update.",
      };
    }
  }

  // serviceName validation
  if (!isUpdate || serviceName !== undefined) {
    if (!serviceName || typeof serviceName !== "string" || serviceName.trim().length < 3) {
      return {
        isValid: false,
        message: "Service name is required and must be at least 3 characters long.",
      };
    }
    if (serviceName.trim().length > 120) {
      return {
        isValid: false,
        message: "Service name cannot exceed 120 characters.",
      };
    }
  }

  // category validation
  if (!isUpdate || category !== undefined) {
    if (!category || typeof category !== "string" || !CATEGORIES.includes(category.trim())) {
      return {
        isValid: false,
        message: `Category must be one of: ${CATEGORIES.join(", ")}.`,
      };
    }
  }

  // description validation
  if (!isUpdate || description !== undefined) {
    if (!description || typeof description !== "string" || description.trim().length < 10) {
      return {
        isValid: false,
        message: "Description is required and must be at least 10 characters long.",
      };
    }
    if (description.trim().length > 3000) {
      return {
        isValid: false,
        message: "Description cannot exceed 3000 characters.",
      };
    }
  }

  // price validation
  if (!isUpdate || price !== undefined) {
    const numPrice = Number(price);
    if (isNaN(numPrice) || numPrice <= 0) {
      return {
        isValid: false,
        message: "Price must be a valid number greater than 0.",
      };
    }
  }

  // location validation
  if (!isUpdate || location !== undefined) {
    if (!location || typeof location !== "string" || location.trim().length < 2) {
      return {
        isValid: false,
        message: "Location is required and must be at least 2 characters long.",
      };
    }
    if (location.trim().length > 150) {
      return {
        isValid: false,
        message: "Location cannot exceed 150 characters.",
      };
    }
  }

  // images validation (array of 1 to 5 valid HTTP/HTTPS URLs)
  if (!isUpdate || images !== undefined) {
    if (!Array.isArray(images) || images.length < 1 || images.length > 5) {
      return {
        isValid: false,
        message: "Images must be an array containing between 1 and 5 image URLs.",
      };
    }

    const urlRegex = /^https?:\/\/.+/i;
    for (const url of images) {
      if (typeof url !== "string" || !urlRegex.test(url.trim())) {
        return {
          isValid: false,
          message: `Invalid image URL: "${url}". Must be a valid http or https URL.`,
        };
      }
    }
  }

  return { isValid: true };
}

/**
 * Validates service availability toggle body
 */
export function validateAvailabilityUpdate(body = {}) {
  if (typeof body.isActive !== "boolean") {
    return {
      isValid: false,
      message: 'Body must include a boolean "isActive" property (true or false).',
    };
  }
  return { isValid: true };
}

/**
 * Validates customer booking request input
 */
export function validateBookingInput(body = {}) {
  const { serviceId, eventDate, eventLocation, message } = body;

  // serviceId
  if (!serviceId || !isValidObjectId(serviceId)) {
    return {
      isValid: false,
      message: "A valid 24-character hex serviceId is required.",
    };
  }

  // eventDate (YYYY-MM-DD, today or future)
  if (!eventDate || typeof eventDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
    return {
      isValid: false,
      message: "Event date must be provided in YYYY-MM-DD format.",
    };
  }

  const [year, month, day] = eventDate.split("-").map(Number);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  if (
    parsedDate.getUTCFullYear() !== year ||
    parsedDate.getUTCMonth() !== month - 1 ||
    parsedDate.getUTCDate() !== day
  ) {
    return {
      isValid: false,
      message: "Event date is not a valid calendar date.",
    };
  }

  const todayStr = new Date().toISOString().split("T")[0];
  if (eventDate < todayStr) {
    return {
      isValid: false,
      message: "Event date must be today or a future date.",
    };
  }

  // eventLocation
  if (!eventLocation || typeof eventLocation !== "string" || eventLocation.trim().length < 2) {
    return {
      isValid: false,
      message: "Event location is required and must be at least 2 characters long.",
    };
  }
  if (eventLocation.trim().length > 200) {
    return {
      isValid: false,
      message: "Event location cannot exceed 200 characters.",
    };
  }

  // message (optional, max 500 chars)
  if (message !== undefined && message !== null) {
    if (typeof message !== "string" || message.length > 500) {
      return {
        isValid: false,
        message: "Message cannot exceed 500 characters.",
      };
    }
  }

  return { isValid: true };
}

/**
 * Validates vendor booking status update body
 */
export function validateBookingStatusUpdate(body = {}) {
  const allowed = [BOOKING_STATUS.ACCEPTED, BOOKING_STATUS.REJECTED];
  if (!body.status || !allowed.includes(body.status)) {
    return {
      isValid: false,
      message: `Status must be either "${BOOKING_STATUS.ACCEPTED}" or "${BOOKING_STATUS.REJECTED}".`,
    };
  }
  return { isValid: true };
}
