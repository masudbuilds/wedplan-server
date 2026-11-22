import { ObjectId } from "mongodb";

/**
 * Checks whether a given string is a valid 24-character hexadecimal MongoDB ObjectId
 */
export function isValidObjectId(id) {
  if (!id || typeof id !== "string") return false;
  return ObjectId.isValid(id) && new ObjectId(id).toString() === id;
}

/**
 * Express middleware to validate an ObjectId URL parameter.
 * Returns 400 Bad Request if the parameter is not a valid ObjectId.
 */
export function validateObjectIdParam(paramName = "id") {
  return (req, res, next) => {
    const id = req.params[paramName];
    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: `Invalid ID format: "${id}". Must be a 24-character hex string.`,
      });
    }
    next();
  };
}
