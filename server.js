const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { pages: subpages, renderSubpage, extractCss } = require('./subpages');
const crypto = require('node:crypto');
const sharp = require('sharp');
const esbuild = require('esbuild');

loadEnvironment();

const port = Number(process.env.PORT || 3000);
const siteUrl = (process.env.SITE_URL || 'https://bubblegumart.de').replace(/\/$/, '');
const legacyRedirects = new Map([
  ['/gallery', '/portfolio/'],
  ['/tags/hamburg', '/kontakt/'],
  ['/categories/tschiggy', '/styles/'],
  ['/categories/impressum', '/impressum/'],
  ['/categories/tattoo', '/styles/'],
  ['/en', '/'],
  ['/tags/custom-tattoo', '/styles/'],
  ['/posts/impressum', '/impressum/'],
  ['/posts/tschiggy', '/styles/'],
  ['/tags/dsgvo', '/datenschutz/'],
  ['/categories/datenschutz', '/datenschutz/'],
  ['/en/categories', '/'],
  ['/categories', '/styles/'],
  ['/tags/dotwork', '/portfolio/'],
  ['/posts/datenschutz', '/datenschutz/'],
  ['/tags/datenschutz', '/datenschutz/'],
  ['/tags/newschool', '/styles/'],
  ['/tags/comic-tattoo', '/styles/'],
  ['/tags/tattoo-artist', '/kontakt/'],
  ['/categories/artists', '/kontakt/'],
]);
const permanentlyRemovedPaths = new Set([
  '/posts/pedi',
  '/categories/pedi',
  '/tags/pedi',
]);
const legalPages = new Map([
  ['/impressum/', 'impressum.html'],
  ['/datenschutz/', 'datenschutz.html'],
]);
const legalCanonicalRedirects = new Map([
  ['/styles', '/styles/'],
  ['/portfolio', '/portfolio/'],
  ['/kontakt', '/kontakt/'],
  ['/impressum', '/impressum/'],
  ['/datenschutz', '/datenschutz/'],
]);
const instagramUserId = process.env.INSTAGRAM_USER_ID;
const instagramAccessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
const localMediaOnly = /^(1|true|yes)$/i.test(process.env.LOCAL_MEDIA_ONLY || '');
const cacheLifetimeMs = 15 * 60 * 1000;
const mediaDirectory = path.resolve(process.env.MEDIA_CACHE_DIR || path.join(__dirname, 'storage', 'instagram'));
const mediaIndexPath = path.join(mediaDirectory, 'media.json');
const profileIndexPath = path.join(mediaDirectory, 'profile.json');
const fontDirectory = path.join(__dirname, 'storage', 'fonts');
const localFonts = [
  { filename: 'inter-300.ttf', url: 'https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuOKfMZg.ttf' },
  { filename: 'inter-400.ttf', url: 'https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfMZg.ttf' },
  { filename: 'inter-500.ttf', url: 'https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuI6fMZg.ttf' },
  { filename: 'inter-600.ttf', url: 'https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuGKYMZg.ttf' },
  { filename: 'lobster-400.ttf', url: 'https://fonts.gstatic.com/s/lobster/v32/neILzCirqoswsqX9_oU.ttf' },
];
const debugEnabled = /^(1|true|yes)$/i.test(process.env.DEBUG || '');
const imageDownloadConcurrency = 6;
const thumbnailWidth = 320;
let mediaCache = { value: readStoredMedia(), expiresAt: 0 };
let mediaRefreshPromise = null;
let profileCache = { value: readStoredProfile(), expiresAt: 0 };
let profileRefreshPromise = null;

function debugLog(message, details = '') {
  if (!debugEnabled) return;
  console.log(`[debug] ${message}${details ? ` ${details}` : ''}`);
}

function loadEnvironment() {
  const environmentPath = path.join(__dirname, '.env');
  if (!fs.existsSync(environmentPath)) return;

  for (const line of fs.readFileSync(environmentPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  }
}

async function downloadFonts() {
  fs.mkdirSync(fontDirectory, { recursive: true });
  for (const font of localFonts) {
    const fontPath = path.join(fontDirectory, font.filename);
    if (fs.existsSync(fontPath)) continue;

    const response = await fetch(font.url);
    if (!response.ok) throw new Error(`Font ${font.filename} konnte nicht geladen werden.`);
    fs.writeFileSync(fontPath, Buffer.from(await response.arrayBuffer()));
    debugLog(`Font heruntergeladen: ${font.filename}`);
  }
}

function readStoredMedia() {
  try {
    const storedMedia = JSON.parse(fs.readFileSync(mediaIndexPath, 'utf8'));
    return Array.isArray(storedMedia)
      ? storedMedia.map((item) => ({ ...item, caption: cleanCaption(item.caption) }))
      : null;
  } catch {
    return null;
  }
}

function cleanCaption(caption) {
  return String(caption || '')
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D\u{1F3FB}-\u{1F3FF}\u20E3]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function readStoredProfile() {
  try {
    const storedProfile = JSON.parse(fs.readFileSync(profileIndexPath, 'utf8'));
    return storedProfile && typeof storedProfile === 'object' ? storedProfile : null;
  } catch {
    return null;
  }
}

function persistProfile(profile) {
  fs.writeFileSync(profileIndexPath, JSON.stringify(profile));
}

async function refreshInstagramProfile() {
  if (!instagramUserId || !instagramAccessToken) {
    throw new Error('Instagram-Zugangsdaten fehlen. INSTAGRAM_USER_ID und INSTAGRAM_ACCESS_TOKEN in .env setzen.');
  }

  const fields = 'username,biography,followers_count,follows_count,media_count,profile_picture_url';
  const url = new URL(`https://graph.instagram.com/${instagramUserId}`);
  url.searchParams.set('fields', fields);
  url.searchParams.set('access_token', instagramAccessToken);

  debugLog('Instagram: Profil-Refresh gestartet');
  const response = await fetch(url);
  debugLog(`Instagram: Profil antwortet mit ${response.status} ${response.statusText}`);

  if (!response.ok) {
    let errorDetails = '';
    try {
      const errorPayload = await response.json();
      errorDetails = errorPayload.error?.message || errorPayload.error?.type || '';
    } catch {
      debugLog('Instagram: Profil-Fehlerantwort war kein JSON');
    }
    throw new Error(`Instagram-Profil konnte nicht geladen werden${errorDetails ? `: ${errorDetails}` : '.'}`);
  }

  const payload = await response.json();
  const profile = {
    username: payload.username || 'tschiggys',
    biography: payload.biography || '',
    posts: payload.media_count ?? 0,
    followers: payload.followers_count ?? 0,
    following: payload.follows_count ?? 0,
    avatarUrl: payload.profile_picture_url || '',
  };
  profileCache = { value: profile, expiresAt: Date.now() + cacheLifetimeMs };
  persistProfile(profile);
  debugLog(`Instagram: Profil-Refresh abgeschlossen (${profile.followers} Follower, ${profile.posts} Beitraege)`);
  return profile;
}

async function getInstagramProfile() {
  if (localMediaOnly && profileCache.value) {
    return profileCache.value;
  }

  if (profileCache.value) {
    if (profileCache.expiresAt <= Date.now() && !profileRefreshPromise) {
      profileRefreshPromise = refreshInstagramProfile()
        .catch((error) => debugLog(`Instagram: Profil-Hintergrund-Refresh fehlgeschlagen: ${error.message}`))
        .finally(() => { profileRefreshPromise = null; });
    }
    return profileCache.value;
  }

  try {
    profileRefreshPromise = refreshInstagramProfile();
    return await profileRefreshPromise;
  } catch (error) {
    error.statusCode = error.statusCode || 502;
    debugLog(`Instagram: erster Profil-Refresh fehlgeschlagen: ${error.stack || error.message}`);
    throw error;
  } finally {
    profileRefreshPromise = null;
  }
}

function imageExtension(contentType) {
  const extensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
  return extensions[contentType?.split(';')[0].toLowerCase()] || '.jpg';
}

function captionSlug(caption) {
  const words = String(caption || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4);
  return words.join('-') || 'tattoo';
}

function findStoredFile(id) {
  const idPattern = new RegExp(`-${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.[a-z0-9]+$`);
  return fs.readdirSync(mediaDirectory, { withFileTypes: true })
    .find((entry) => entry.isFile() && idPattern.test(entry.name));
}

async function storeImage(id, remoteUrl, caption) {
  const existingFile = findStoredFile(id);
  if (existingFile) {
    debugLog(`Bild ${id}: Cache-Treffer (${existingFile.name})`);
    return `/instagram-media/${existingFile.name}`;
  }

  const response = await fetch(remoteUrl);
  debugLog(`Bild ${id}: Download ${response.status} ${response.statusText}`);
  if (!response.ok) throw new Error(`Bild ${id} konnte nicht gespeichert werden.`);

  const filename = `${captionSlug(caption)}-${id}${imageExtension(response.headers.get('content-type'))}`;
  const image = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(path.join(mediaDirectory, filename), image);
  debugLog(`Bild ${id}: gespeichert als ${filename} (${image.length} Bytes)`);
  return `/instagram-media/${filename}`;
}

async function createThumbnail(imageUrl, force = false) {
  const filename = path.basename(imageUrl);
  const thumbnailFilename = `${path.parse(filename).name}-thumb.webp`;
  const thumbnailPath = path.join(mediaDirectory, thumbnailFilename);
  if (force || !fs.existsSync(thumbnailPath)) {
    await sharp(path.join(mediaDirectory, filename))
      .rotate()
      .resize(thumbnailWidth, thumbnailWidth, { fit: 'cover', position: 'attention' })
      .webp({ quality: 72 })
      .toFile(thumbnailPath);
    debugLog(`Vorschau erstellt: ${thumbnailFilename}`);
  }
  return `/instagram-media/${thumbnailFilename}`;
}

async function addThumbnail(item, force = false) {
  try {
    return { ...item, thumbnailUrl: await createThumbnail(item.imageUrl, force) };
  } catch (error) {
    debugLog(`Vorschau fuer Bild ${item.id} fehlgeschlagen: ${error.message}`);
    return item;
  }
}

async function createStoredThumbnails() {
  if (!mediaCache.value?.length) return;
  const media = await mapWithConcurrency(mediaCache.value, imageDownloadConcurrency, async (item) => {
    if (!hasStoredImage(item.imageUrl)) return item;
    return addThumbnail(item);
  });
  mediaCache = { ...mediaCache, value: media };
  persistMedia(media);
  debugLog(`Instagram: Vorschauen fuer ${media.length} lokale Medien aktualisiert`);
}

// Regenerates every thumbnail from the already-downloaded originals, ignoring any existing thumbnail file.
async function rebuildAllThumbnails() {
  const media = readStoredMedia() || [];
  if (!media.length) {
    console.log('Keine gespeicherten Medien gefunden, nichts zu tun.');
    return;
  }

  let rebuiltCount = 0;
  let skippedCount = 0;
  const updatedMedia = await mapWithConcurrency(media, imageDownloadConcurrency, async (item) => {
    if (!hasStoredImage(item.imageUrl)) {
      skippedCount += 1;
      return item;
    }
    rebuiltCount += 1;
    return addThumbnail(item, true);
  });

  persistMedia(updatedMedia);
  console.log(`Vorschauen neu erstellt: ${rebuiltCount}, uebersprungen (kein lokales Bild): ${skippedCount}`);
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const itemIndex = nextIndex;
      nextIndex += 1;
      results[itemIndex] = await mapper(items[itemIndex]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function persistMedia(media) {
  fs.writeFileSync(mediaIndexPath, JSON.stringify(media));
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function createSitemap() {
  const media = mediaCache.value || readStoredMedia() || [];
  const imageEntries = media
    .filter((item) => item.imageUrl?.startsWith('/instagram-media/'))
    .map((item) => `    <image:image>\n      <image:loc>${escapeXml(`${siteUrl}${item.imageUrl}`)}</image:loc>${cleanCaption(item.caption) ? `\n      <image:title>${escapeXml(cleanCaption(item.caption))}</image:title>` : ''}\n    </image:image>`)
    .join('\n');
  const legalEntries = [...Object.keys(subpages), ...legalPages.keys()]
    .map((pathname) => `  <url>\n    <loc>${escapeXml(`${siteUrl}${pathname}`)}</loc>\n  </url>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>${escapeXml(`${siteUrl}/`)}</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>${imageEntries ? `\n${imageEntries}` : ''}
  </url>
${legalEntries}
</urlset>
`;
}

function hasStoredImage(imageUrl) {
  if (!imageUrl?.startsWith('/instagram-media/')) return false;
  return fs.existsSync(path.join(mediaDirectory, path.basename(imageUrl)));
}

async function fetchInstagramMediaPages(firstUrl, maxPages = Infinity) {
  const allItems = [];
  let nextUrl = firstUrl;
  let page = 0;

  while (nextUrl && page < maxPages) {
    page += 1;
    debugLog(`Instagram: lade Seite ${page}`);
    const response = await fetch(nextUrl);
    debugLog(`Instagram: Seite ${page} antwortet mit ${response.status} ${response.statusText}`);

    if (!response.ok) {
      let errorDetails = '';
      let errorPayload;
      try {
        errorPayload = await response.json();
        errorDetails = errorPayload.error?.message || errorPayload.error?.type || '';
        debugLog(`Instagram: Fehlerdetails: ${JSON.stringify(errorPayload.error || errorPayload)}`);
      } catch {
        debugLog('Instagram: Fehlerantwort war kein JSON');
      }
      if (errorPayload?.error?.code === 190) {
        const error = new Error(`Instagram-Access-Token ist ungueltig oder falsch formatiert: ${errorDetails}`);
        error.statusCode = 503;
        throw error;
      }
      throw new Error(`Instagram konnte nicht geladen werden${errorDetails ? `: ${errorDetails}` : '.'}`);
    }

    const payload = await response.json();
    allItems.push(...(payload.data || []));
    nextUrl = payload.paging?.next || null;
  }

  debugLog(`Instagram: Pagination abgeschlossen (${allItems.length} Medien auf ${page} Seiten)`);
  return allItems;
}

async function refreshInstagramMedia(loadAllPages) {
  if (!instagramUserId || !instagramAccessToken) {
    throw new Error('Instagram-Zugangsdaten fehlen. INSTAGRAM_USER_ID und INSTAGRAM_ACCESS_TOKEN in .env setzen.');
  }

  if (!/^\d+$/.test(instagramUserId)) {
    const error = new Error(`INSTAGRAM_USER_ID muss eine numerische Instagram-User-ID sein; erhalten wurde "${instagramUserId}".`);
    error.statusCode = 503;
    throw error;
  }

  const fields = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count';
  const url = new URL(`https://graph.instagram.com/${instagramUserId}/media`);
  url.searchParams.set('fields', fields);
  url.searchParams.set('access_token', instagramAccessToken);

  debugLog(`Instagram: ${loadAllPages ? 'vollstaendiger' : 'inkrementeller'} Refresh gestartet`);
  const fetchedMedia = await fetchInstagramMediaPages(url, loadAllPages ? Infinity : 1);
  const remoteMedia = fetchedMedia
    .filter((item) => item.media_type !== 'VIDEO' || item.thumbnail_url)
    .map((item) => ({
      id: item.id,
      caption: cleanCaption(item.caption || 'Tattoo von @tschiggys'),
      imageUrl: item.media_type === 'VIDEO' ? item.thumbnail_url : item.media_url,
      permalink: item.permalink,
      likes: item.like_count ?? 0,
      comments: item.comments_count ?? 0,
      timestamp: item.timestamp,
    }))
    .filter((item) => item.imageUrl);
  debugLog(`Instagram: ${fetchedMedia.length} API-Medien, ${remoteMedia.length} mit herunterladbarer Bild-URL`);

  const existingMedia = new Map((mediaCache.value || []).map((item) => [item.id, item]));
  let downloadedCount = 0;
  const refreshedMedia = await mapWithConcurrency(remoteMedia, imageDownloadConcurrency, async (item) => {
    const existingItem = existingMedia.get(item.id);
    if (existingItem && hasStoredImage(existingItem.imageUrl)) {
      return addThumbnail({ ...existingItem, ...item, imageUrl: existingItem.imageUrl });
    }
    downloadedCount += 1;
    try {
      const imageUrl = await storeImage(item.id, item.imageUrl, item.caption);
      return addThumbnail({ ...item, imageUrl });
    } catch (error) {
      debugLog(`Bild ${item.id}: Download fehlgeschlagen: ${error.message}`);
      throw error;
    }
  });

  const refreshedIds = new Set(refreshedMedia.map((item) => item.id));
  const olderMedia = (mediaCache.value || []).filter((item) => !refreshedIds.has(item.id));
  const media = [...refreshedMedia, ...olderMedia];
  mediaCache = { value: media, expiresAt: Date.now() + cacheLifetimeMs };
  persistMedia(media);
  debugLog(`Instagram: Refresh abgeschlossen (${downloadedCount} neue Downloads, ${media.length} lokale Medien)`);
  return media;
}

async function getInstagramMedia() {
  if (localMediaOnly && mediaCache.value) {
    debugLog(`Instagram: LOCAL_MEDIA_ONLY aktiv, verwende lokale Auswahl (${mediaCache.value.length} Bilder)`);
    return mediaCache.value;
  }

  if (mediaCache.value) {
    if (mediaCache.expiresAt <= Date.now() && !mediaRefreshPromise) {
      mediaRefreshPromise = refreshInstagramMedia(false)
        .catch((error) => debugLog(`Instagram: Hintergrund-Refresh fehlgeschlagen: ${error.message}`))
        .finally(() => { mediaRefreshPromise = null; });
      debugLog(`Instagram: liefere ${mediaCache.value.length} lokale Medien sofort aus`);
    }
    return mediaCache.value;
  }

  try {
    mediaRefreshPromise = refreshInstagramMedia(true);
    return await mediaRefreshPromise;
  } catch (error) {
    error.statusCode = error.statusCode || 502;
    debugLog(`Instagram: erster Refresh fehlgeschlagen: ${error.stack || error.message}`);
    throw error;
  } finally {
    mediaRefreshPromise = null;
  }
}

function sendJson(request, response, statusCode, value) {
  const body = JSON.stringify(value);
  const acceptsGzip = /\bgzip\b/.test(request.headers['accept-encoding'] || '');
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' };

  if (!acceptsGzip) {
    response.writeHead(statusCode, headers);
    response.end(body);
    return;
  }

  zlib.gzip(body, (error, compressed) => {
    if (error) {
      response.writeHead(statusCode, headers);
      response.end(body);
      return;
    }
    response.writeHead(statusCode, { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
    response.end(compressed);
  });
}

const compressedBodies = new Map();

function sendText(request, response, contentType, body, cacheControl) {
  const etag = `"${crypto.createHash('sha1').update(body).digest('base64url')}"`;
  const headers = { 'Content-Type': contentType, 'Cache-Control': cacheControl, ETag: etag, Vary: 'Accept-Encoding' };

  if (request.headers['if-none-match'] === etag) {
    response.writeHead(304, headers);
    response.end();
    return;
  }

  let variants = compressedBodies.get(etag);
  if (!variants) {
    if (compressedBodies.size > 50) compressedBodies.clear();
    variants = { br: zlib.brotliCompressSync(body), gzip: zlib.gzipSync(body, { level: 9 }) };
    compressedBodies.set(etag, variants);
  }

  const accepted = request.headers['accept-encoding'] || '';
  const encoding = /\bbr\b/.test(accepted) ? 'br' : /\bgzip\b/.test(accepted) ? 'gzip' : null;
  if (!encoding) {
    response.writeHead(200, headers);
    response.end(body);
    return;
  }
  response.writeHead(200, { ...headers, 'Content-Encoding': encoding });
  response.end(variants[encoding]);
}

function absoluteUrl(pathname) {
  return `${siteUrl}${pathname}`;
}

const minifiedHtmlCache = new Map();

// Minifiziert nur Inline-CSS und -JS; bei Fehlern bleibt der Originalblock erhalten.
function minifyHtml(html) {
  const cached = minifiedHtmlCache.get(html);
  if (cached) return cached;

  const minifyBlock = (loader) => (match, open, code, close) => {
    try {
      return `${open}${esbuild.transformSync(code, { loader, minify: true, legalComments: 'none' }).code.trim()}${close}`;
    } catch (error) {
      debugLog(`Minifizierung (${loader}) fehlgeschlagen: ${error.message}`);
      return match;
    }
  };
  const result = html
    .replace(/(<style>)([\s\S]*?)(<\/style>)/g, minifyBlock('css'))
    .replace(/(<script>)([\s\S]*?)(<\/script>)/g, minifyBlock('js'));

  minifiedHtmlCache.clear();
  minifiedHtmlCache.set(html, result);
  return result;
}

function renderHomepage() {
  const media = (mediaCache.value || readStoredMedia() || [])
    .filter((item) => item.imageUrl?.startsWith('/instagram-media/'))
    .slice(0, 12);
  const logoImage = absoluteUrl('/storage/img/0980fd88548cae3e17e0f577e559e2cfa6710bad.webp');

  const imageObjects = media.map((item) => ({
    '@type': 'ImageObject',
    contentUrl: absoluteUrl(item.imageUrl),
    thumbnailUrl: absoluteUrl(item.thumbnailUrl || item.imageUrl),
    name: cleanCaption(item.caption) || 'Tattoo von Tschiggys Bubblegum Art',
    caption: cleanCaption(item.caption) || undefined,
    uploadDate: item.timestamp || undefined,
    creator: { '@id': `${siteUrl}/#studio` },
    creditText: 'Tschiggys Bubblegum Art Tattoo',
    license: absoluteUrl('/impressum/'),
    acquireLicensePage: absoluteUrl('/kontakt/'),
  }));

  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${siteUrl}/#website`,
        url: `${siteUrl}/`,
        name: 'Tschiggys Bubblegum Art Tattoo',
        inLanguage: 'de-DE',
        publisher: { '@id': `${siteUrl}/#studio` },
      },
      {
        '@type': 'WebPage',
        '@id': `${siteUrl}/#webpage`,
        url: `${siteUrl}/`,
        isPartOf: { '@id': `${siteUrl}/#website` },
        primaryImageOfPage: { '@type': 'ImageObject', url: logoImage },
        about: { '@id': `${siteUrl}/#studio` },
        hasPart: [
          { '@type': 'WebPageElement', name: 'Instagram', url: `${siteUrl}/#instagram` },
          { '@type': 'WebPageElement', name: 'Tattoo Styles', url: `${siteUrl}/styles/` },
          { '@type': 'WebPageElement', name: 'Portfolio', url: `${siteUrl}/portfolio/` },
          { '@type': 'WebPageElement', name: 'Kontakt', url: `${siteUrl}/kontakt/` },
        ],
      },
      {
        '@type': 'SiteNavigationElement',
        name: ['Instagram', 'Styles', 'Portfolio', 'Kontakt', 'Impressum', 'Datenschutz'],
        url: ['/#instagram', '/styles/', '/portfolio/', '/kontakt/', '/impressum/', '/datenschutz/'].map(absoluteUrl),
      },
      {
        '@type': 'TattooParlor',
        '@id': `${siteUrl}/#studio`,
        name: 'Tschiggys Bubblegum Art Tattoo',
        url: `${siteUrl}/`,
        email: 'tschiggys@bubblegumart.de',
        image: [logoImage, ...media.slice(0, 6).map((item) => absoluteUrl(item.imageUrl))],
        address: {
          '@type': 'PostalAddress',
          streetAddress: 'Eimsbüttler Chaussee 18',
          postalCode: '20259',
          addressLocality: 'Hamburg',
          addressCountry: 'DE',
        },
        areaServed: ['Hamburg', 'Eimsbüttel', 'Sternschanze'],
        sameAs: ['https://instagram.com/tschiggys'],
      },
      ...(imageObjects.length
        ? [{
          '@type': 'ImageGallery',
          '@id': `${siteUrl}/#gallery`,
          url: `${siteUrl}/portfolio/`,
          name: 'Tattoo Portfolio Hamburg',
          about: { '@id': `${siteUrl}/#studio` },
          image: imageObjects,
        }]
        : []),
    ],
  };

  const galleryItems = media.slice(0, 8).map((item, index) => {
    const caption = escapeXml(cleanCaption(item.caption));
    const variant = index === 1 ? ' tall' : index === 3 ? ' wide' : '';
    return `<a class="bw3-gallery-item${variant}" href="${escapeXml(item.imageUrl)}"><img src="${escapeXml(item.thumbnailUrl || item.imageUrl)}" alt="${caption || 'Tattoo von Tschiggys Bubblegum Art'}" width="${thumbnailWidth}" height="${thumbnailWidth}" loading="lazy" decoding="async"><div class="bw3-gallery-caption">${caption}</div></a>`;
  }).join('');

  const jsonLd = JSON.stringify(graph).replace(/</g, '\\u003c');
  return minifyHtml(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'))
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, `<script type="application/ld+json">${jsonLd}</script>`)
    .replace('<div class="bw3-gallery" id="galleryGrid"></div>', `<div class="bw3-gallery" id="galleryGrid">${galleryItems}</div>`);
}

const server = http.createServer(async (request, response) => {
  const startedAt = Date.now();
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const normalizedPath = requestUrl.pathname.length > 1 ? requestUrl.pathname.replace(/\/+$/, '') : requestUrl.pathname;
  debugLog(`Request: ${request.method} ${requestUrl.pathname}${requestUrl.search}`);

  const legacyQueryTarget = requestUrl.pathname === '/' && ['3269', '3233'].includes(requestUrl.searchParams.get('p'))
    ? '/'
    : null;
  const legacyTarget = legacyQueryTarget || legacyRedirects.get(normalizedPath) || legalCanonicalRedirects.get(requestUrl.pathname);
  if (legacyTarget) {
    response.writeHead(301, {
      Location: legacyTarget,
      'Cache-Control': 'public, max-age=31536000',
    });
    response.end();
    return;
  }

  if (permanentlyRemovedPaths.has(normalizedPath)) {
    response.writeHead(410, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    });
    response.end('Dieser Inhalt ist dauerhaft nicht mehr verfügbar.');
    return;
  }

  if (subpages[requestUrl.pathname]) {
    const media = (mediaCache.value || readStoredMedia() || []).filter((item) => item.imageUrl?.startsWith('/instagram-media/'));
    const html = renderSubpage(requestUrl.pathname, { siteUrl, escape: escapeXml, cleanCaption, media, css: extractCss() });
    sendText(request, response, 'text/html; charset=utf-8', minifyHtml(html), 'public, max-age=0, must-revalidate');
    return;
  }

  const legalPage = legalPages.get(requestUrl.pathname);
  if (legalPage) {
    sendText(request, response, 'text/html; charset=utf-8', fs.readFileSync(path.join(__dirname, legalPage), 'utf8'), 'public, max-age=3600');
    return;
  }

  if (requestUrl.pathname === '/api/instagram-media') {
    try {
      sendJson(request, response, 200, { data: await getInstagramMedia() });
      debugLog(`Response: 200 nach ${Date.now() - startedAt} ms`);
    } catch (error) {
      debugLog(`Response: ${error.statusCode || 500} nach ${Date.now() - startedAt} ms: ${error.message}`);
      sendJson(request, response, error.statusCode || 500, { error: error.message || 'Serverfehler' });
    }
    return;
  }

  if (requestUrl.pathname.startsWith('/fonts/')) {
    const filename = path.basename(requestUrl.pathname);
    if (!localFonts.some((font) => font.filename === filename)) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Font nicht gefunden');
      return;
    }

    response.writeHead(200, {
      'Content-Type': 'font/ttf',
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    fs.createReadStream(path.join(fontDirectory, filename)).pipe(response);
    return;
  }

  if (requestUrl.pathname === '/api/instagram-profile') {
    try {
      sendJson(request, response, 200, await getInstagramProfile());
      debugLog(`Response: 200 nach ${Date.now() - startedAt} ms`);
    } catch (error) {
      debugLog(`Response: ${error.statusCode || 500} nach ${Date.now() - startedAt} ms: ${error.message}`);
      sendJson(request, response, error.statusCode || 500, { error: error.message || 'Serverfehler' });
    }
    return;
  }

  if (requestUrl.pathname === '/sitemap.xml') {
    sendText(request, response, 'application/xml; charset=utf-8', createSitemap(), 'public, max-age=3600');
    return;
  }

  if (requestUrl.pathname === '/sitemapindex.xml') {
    response.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    response.end(`<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <sitemap>\n    <loc>${escapeXml(`${siteUrl}/sitemap.xml`)}</loc>\n  </sitemap>\n</sitemapindex>\n`);
    return;
  }

  if (requestUrl.pathname === '/robots.txt') {
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    response.end(`User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${siteUrl}/sitemapindex.xml\n`);
    return;
  }

  if (requestUrl.pathname.startsWith('/instagram-media/')) {
    const filename = path.basename(requestUrl.pathname);
    const filePath = path.join(mediaDirectory, filename);
    if (!fs.existsSync(filePath)) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Bild nicht gefunden');
      return;
    }

    const contentTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
    response.writeHead(200, {
      'Content-Type': contentTypes[path.extname(filename).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    fs.createReadStream(filePath).pipe(response);
    return;
  }

  if (requestUrl.pathname === '/favicon.svg') {
    response.writeHead(200, {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    fs.createReadStream(path.join(__dirname, 'favicon.svg')).pipe(response);
    return;
  }

  if (requestUrl.pathname === '/favicon.ico') {
    response.writeHead(200, {
      'Content-Type': 'image/x-icon',
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    fs.createReadStream(path.join(__dirname, 'favicon.ico')).pipe(response);
    return;
  }

  if (requestUrl.pathname === '/' || requestUrl.pathname === '/index.html') {
    sendText(request, response, 'text/html; charset=utf-8', renderHomepage(), 'public, max-age=0, must-revalidate');
    return;
  }

  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('Nicht gefunden');
});

async function startServer() {
  fs.mkdirSync(mediaDirectory, { recursive: true });
  await downloadFonts();
  server.listen(port, () => {
    console.log(`Bubblegum Art läuft auf http://localhost:${port}`);
    debugLog(`Konfiguration: PORT=${port}, Instagram-Zugangsdaten=${instagramUserId && instagramAccessToken ? 'gesetzt' : 'fehlen'}, LOCAL_MEDIA_ONLY=${localMediaOnly}, MEDIA_CACHE_DIR=${mediaDirectory}`);
    createStoredThumbnails().catch((error) => debugLog(`Instagram: Vorschau-Migration fehlgeschlagen: ${error.message}`));
  });
}

if (process.argv.includes('--rebuild-thumbnails')) {
  rebuildAllThumbnails()
    .catch((error) => {
      console.error(`Vorschauen konnten nicht neu erstellt werden: ${error.message}`);
      process.exitCode = 1;
    });
} else {
  startServer().catch((error) => {
    console.error(`Server konnte nicht gestartet werden: ${error.message}`);
    process.exitCode = 1;
  });
}
