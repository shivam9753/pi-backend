const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// Ensure the Submission model is registered (models are required in app.js)
const Submission = mongoose.model('Submission');

const SITE_HOST = (process.env.SITE_HOST || process.env.FRONTEND_URL || 'https://poemsindia.in').replace(/\/$/, '');
const SITEMAP_TTL_MS = Number.parseInt(process.env.SITEMAP_TTL_MS || String(10 * 60 * 1000), 10); // default 10 minutes

let sitemapCache = {
  xml: null,
  expiresAt: 0
};

function escapeXml(str) {
  if (!str) return '';
  const s = String(str);
  return s.replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

router.get('/sitemap.xml', async (req, res, next) => {
  try {
    const now = Date.now();
    if (sitemapCache.xml && sitemapCache.expiresAt > now) {
      res.set('Content-Type', 'application/xml');
      return res.send(sitemapCache.xml);
    }

    // Static important pages to include and their metadata (influence search engines)
    const staticPaths = [
      { path: '/', priority: '1.0', changefreq: 'daily' },
      { path: '/explore', priority: '0.9', changefreq: 'daily' },
      { path: '/featured-poems', priority: '0.8', changefreq: 'weekly' },
      { path: '/published-authors', priority: '0.8', changefreq: 'weekly' },
      { path: '/submission', priority: '0.7', changefreq: 'monthly' }
    ];

    const urls = staticPaths.map(p => ({
      loc: `${SITE_HOST}${p.path}`,
      lastmod: new Date().toISOString().split('T')[0],
      changefreq: p.changefreq,
      priority: p.priority
    }));

    // Fetch published submissions (limit to 50k to stay within sitemap limits)
    const submissions = await Submission.find({ status: 'published' })
      .select('seo.slug seo.canonical updatedAt publishedAt createdAt title')
      .sort({ updatedAt: -1 })
      .limit(50000)
      .lean()
      .exec();

    submissions.forEach(s => {
      const slug = (s.seo && s.seo.slug) || s.slug;
      if (!slug) return; // skip if no usable slug

      const loc = (s.seo && s.seo.canonical) ? s.seo.canonical : `${SITE_HOST}/post/${encodeURIComponent(slug)}`;
      const lastmodDate = s.updatedAt || s.publishedAt || s.createdAt;
      const lastmod = lastmodDate ? new Date(lastmodDate).toISOString().split('T')[0] : null;

      urls.push({ loc, lastmod });
    });

    // Build XML
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    for (const u of urls) {
      xml += '  <url>\n';
      xml += `    <loc>${escapeXml(u.loc)}</loc>\n`;
      if (u.lastmod) xml += `    <lastmod>${escapeXml(u.lastmod)}</lastmod>\n`;
      if (u.changefreq) xml += `    <changefreq>${escapeXml(u.changefreq)}</changefreq>\n`;
      if (u.priority) xml += `    <priority>${escapeXml(u.priority)}</priority>\n`;
      xml += '  </url>\n';
    }
    xml += '</urlset>';

    // Cache and return
    sitemapCache.xml = xml;
    sitemapCache.expiresAt = Date.now() + SITEMAP_TTL_MS;

    res.set('Content-Type', 'application/xml');
    res.send(xml);
  } catch (err) {
    next(err);
  }
});

// Serve robots.txt at site root
router.get('/robots.txt', (req, res) => {
  const lines = [
    'User-agent: *',
    'Disallow: /admin',
    'Disallow: /workspace',
    'Disallow: /studio',
    'Disallow: /login',
    'Disallow: /user-profile',
    'Disallow: /search',
    '',
    // Sitemap reference
    `Sitemap: ${SITE_HOST}/sitemap.xml`
  ];

  res.type('text/plain').send(lines.join('\n'));
});

// Expose cache invalidation helper
router.clearCache = function() {
  sitemapCache.xml = null;
  sitemapCache.expiresAt = 0;
  console.log('🗺️ Sitemap cache cleared');
};

module.exports = router;
