/**
 * Escapes special regex characters in a user search string to prevent regex injection
 */
export function escapeRegex(text = "") {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}
