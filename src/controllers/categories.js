import { CATEGORIES } from "../utils/constants.js";

export function getCategories(req, res) {
  res.json({
    success: true,
    categories: CATEGORIES,
  });
}
