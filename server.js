const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

loadEnvironment();

const port = Number(process.env.PORT || 3000);
const siteUrl = (process.env.SITE_URL || 'https://bubblegumart.de').replace(/\/$/, '');
const instagramUserId = process.env.INSTAGRAM_USER_ID;
const instagramAccessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
const localMediaOnly = /^(1|true|yes)$/i.test(process.env.LOCAL_MEDIA_ONLY || '');
const cacheLifetimeMs = 15 * 60 * 1000;
const mediaDirectory = path.resolve(process.env.MEDIA_CACHE_DIR || path.join(__dirname, 'storage', 'instagram'));
const mediaIndexPath = path.join(mediaDirectory, 'media.json');
const debugEnabled = /^(1|true|yes)$/i.test(process.env.DEBUG || '');
let mediaCache = { value: readStoredMedia(), expiresAt: 0 };
let mediaRefreshPromise = null;

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

function readStoredMedia() {
  try {
    const storedMedia = JSON.parse(fs.readFileSync(mediaIndexPath, 'utf8'));
    return Array.isArray(storedMedia) ? storedMedia : null;
  } catch {
    return null;
  }
}

function imageExtension(contentType) {
  const extensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
  return extensions[contentType?.split(';')[0].toLowerCase()] || '.jpg';
}

async function storeImage(id, remoteUrl) {
  const existingFile = fs.readdirSync(mediaDirectory, { withFileTypes: true })
    .find((entry) => entry.isFile() && entry.name.startsWith(`${id}.`));
  if (existingFile) {
    debugLog(`Bild ${id}: Cache-Treffer (${existingFile.name})`);
    return `/instagram-media/${existingFile.name}`;
  }

  const response = await fetch(remoteUrl);
  debugLog(`Bild ${id}: Download ${response.status} ${response.statusText}`);
  if (!response.ok) throw new Error(`Bild ${id} konnte nicht gespeichert werden.`);

  const filename = `${id}${imageExtension(response.headers.get('content-type'))}`;
  fs.writeFileSync(path.join(mediaDirectory, filename), Buffer.from(await response.arrayBuffer()));
  return `/instagram-media/${filename}`;
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
    .map((item) => `    <image:image>\n      <image:loc>${escapeXml(`${siteUrl}${item.imageUrl}`)}</image:loc>${item.caption ? `\n      <image:title>${escapeXml(item.caption)}</image:title>` : ''}\n    </image:image>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>${escapeXml(`${siteUrl}/`)}</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>${imageEntries ? `\n${imageEntries}` : ''}
  </url>
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
  const remoteMedia = (await fetchInstagramMediaPages(url, loadAllPages ? Infinity : 1))
    .filter((item) => item.media_type !== 'VIDEO' || item.thumbnail_url)
    .map((item) => ({
      id: item.id,
      caption: item.caption || 'Tattoo von @tschiggys',
      imageUrl: item.media_type === 'VIDEO' ? item.thumbnail_url : item.media_url,
      permalink: item.permalink,
      likes: item.like_count ?? 0,
      comments: item.comments_count ?? 0,
      timestamp: item.timestamp,
    }))
    .filter((item) => item.imageUrl);

  const existingMedia = new Map((mediaCache.value || []).map((item) => [item.id, item]));
  let downloadedCount = 0;
  const refreshedMedia = await Promise.all(remoteMedia.map(async (item) => {
    const existingItem = existingMedia.get(item.id);
    if (existingItem && hasStoredImage(existingItem.imageUrl)) {
      return { ...existingItem, ...item, imageUrl: existingItem.imageUrl };
    }
    downloadedCount += 1;
    return { ...item, imageUrl: await storeImage(item.id, item.imageUrl) };
  }));

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

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
  response.end(JSON.stringify(value));
}

const server = http.createServer(async (request, response) => {
  const startedAt = Date.now();
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  debugLog(`Request: ${request.method} ${requestUrl.pathname}${requestUrl.search}`);

  if (requestUrl.pathname === '/api/instagram-media') {
    try {
      sendJson(response, 200, { data: await getInstagramMedia() });
      debugLog(`Response: 200 nach ${Date.now() - startedAt} ms`);
    } catch (error) {
      debugLog(`Response: ${error.statusCode || 500} nach ${Date.now() - startedAt} ms: ${error.message}`);
      sendJson(response, error.statusCode || 500, { error: error.message || 'Serverfehler' });
    }
    return;
  }

  if (requestUrl.pathname === '/sitemap.xml') {
    const sitemap = createSitemap();
    response.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    response.end(sitemap);
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

  if (requestUrl.pathname === '/' || requestUrl.pathname === '/index.html') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(path.join(__dirname, 'index.html')).pipe(response);
    return;
  }

  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('Nicht gefunden');
});

fs.mkdirSync(mediaDirectory, { recursive: true });

server.listen(port, () => {
  console.log(`Bubblegum Art läuft auf http://localhost:${port}`);
  debugLog(`Konfiguration: PORT=${port}, Instagram-Zugangsdaten=${instagramUserId && instagramAccessToken ? 'gesetzt' : 'fehlen'}, LOCAL_MEDIA_ONLY=${localMediaOnly}, MEDIA_CACHE_DIR=${mediaDirectory}`);
});