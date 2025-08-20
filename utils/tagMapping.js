/**
 * Tag utility functions for handling readable tag names
 * No UUID mappings - all tags should be readable strings
 */

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Clean and validate a single tag
 * @param {string} tag - The tag to clean
 * @returns {string} - The cleaned tag name
 */
function mapSingleTag(tag) {
  if (!tag || typeof tag !== 'string') {
    return '';
  }
  
  const trimmedTag = tag.trim();
  
  // Filter out UUID tags - we don't want them anymore
  if (UUID_REGEX.test(trimmedTag)) {
    return '';
  }
  
  // Return cleaned readable tag
  return trimmedTag;
}

/**
 * Clean and filter an array of tags
 * @param {string[]} tags - Array of tags to clean
 * @returns {string[]} - Array of cleaned readable tag names
 */
function mapTagArray(tags) {
  if (!Array.isArray(tags)) {
    return [];
  }
  
  return tags
    .map(mapSingleTag)
    .filter(tag => tag.length > 0); // Remove empty tags and filtered UUIDs
}

/**
 * Check if a tag is a UUID format
 * @param {string} tag - The tag to check
 * @returns {boolean} - True if tag is UUID format
 */
function isUuidTag(tag) {
  return typeof tag === 'string' && UUID_REGEX.test(tag.trim());
}

/**
 * Filter out UUID tags from an array (we don't want any UUIDs)
 * @param {string[]} tags - Array of tags to filter
 * @returns {string[]} - Array with UUID tags removed
 */
function filterUnmappedUuids(tags) {
  if (!Array.isArray(tags)) {
    return [];
  }
  
  return tags.filter(tag => {
    const trimmedTag = tag?.trim();
    // Keep only non-UUID tags
    return !isUuidTag(trimmedTag);
  });
}

module.exports = {
  mapSingleTag,
  mapTagArray,
  isUuidTag,
  filterUnmappedUuids
};