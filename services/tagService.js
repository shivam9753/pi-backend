const Tag = require('../models/Tag');

function normalizeName(name) {
  if (!name || typeof name !== 'string') return '';
  // Trim, collapse spaces, remove diacritics
  const trimmed = name.trim().replace(/\s+/g, ' ');
  const withoutDiacritics = trimmed.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  return withoutDiacritics;
}

function generateSlug(name) {
  if (!name) return '';
  return normalizeName(name)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function findOrCreateByName(name) {
  const normalized = normalizeName(name);
  const slug = generateSlug(normalized);
  if (!slug) throw new Error('Invalid tag name');

  // Try find existing by slug
  let tag = await Tag.findOne({ slug }).exec();
  if (tag) return tag;

  // Create new tag
  try {
    tag = await Tag.create({ name: normalized, slug });
    return tag;
  } catch (err) {
    // Handle race conditions where another process created the tag
    if (err.code === 11000) { // duplicate key
      return await Tag.findOne({ slug }).exec();
    }
    throw err;
  }
}

async function findOrCreateMany(names = []) {
  const unique = Array.from(new Set((names || []).map(n => (n || '').trim()).filter(Boolean)));
  const results = [];
  for (const n of unique) {
    const tag = await findOrCreateByName(n);
    results.push(tag);
  }
  return results;
}

module.exports = {
  normalizeName,
  generateSlug,
  findOrCreateByName,
  findOrCreateMany
};
