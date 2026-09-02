const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

loadEnvironment();

const port = Number(process.env.PORT || 3000);
const instagramUserId = process.env.INSTAGRAM_USER_ID;
const instagramAccessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
const cacheLifetimeMs = 15 * 60 * 1000;
const mediaDirectory = path.resolve(process.env.MEDIA_CACHE_DIR || path.join(__dirname, 'storage', 'instagram'));
const mediaIndexPath = path.join(mediaDirectory, 'media.json');
let mediaCache = { value: readStoredMedia(), expiresAt: 0 };

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
  if (existingFile) return `/instagram-media/${existingFile.name}`;

  const response = await fetch(remoteUrl);
  if (!response.ok) throw new Error(`Bild ${id} konnte nicht gespeichert werden.`);

  const filename = `${id}${imageExtension(response.headers.get('content-type'))}`;
  fs.writeFileSync(path.join(mediaDirectory, filename), Buffer.from(await response.arrayBuffer()));
  return `/instagram-media/${filename}`;
}

function persistMedia(media) {
  fs.writeFileSync(mediaIndexPath, JSON.stringify(media));
}

async function getInstagramMedia() {
  if (mediaCache.value && mediaCache.expiresAt > Date.now()) return mediaCache.value;

  if (!instagramUserId || !instagramAccessToken) {
    if (mediaCache.value) return mediaCache.value;
    const error = new Error('Instagram-Zugangsdaten fehlen. INSTAGRAM_USER_ID und INSTAGRAM_ACCESS_TOKEN in .env setzen.');
    error.statusCode = 503;
    throw error;
  }

  const fields = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count';
  const url = new URL(`https://graph.instagram.com/${instagramUserId}/media`);
  url.searchParams.set('fields', fields);
  url.searchParams.set('access_token', instagramAccessToken);

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Instagram konnte nicht geladen werden.');

    const payload = await response.json();
    const remoteMedia = (payload.data || [])
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

    const media = await Promise.all(remoteMedia.map(async (item) => ({
      ...item,
      imageUrl: await storeImage(item.id, item.imageUrl),
    })));

    mediaCache = { value: media, expiresAt: Date.now() + cacheLifetimeMs };
    persistMedia(media);
    return media;
  } catch (error) {
    if (mediaCache.value) {
      mediaCache.expiresAt = Date.now() + cacheLifetimeMs;
      return mediaCache.value;
    }
    error.statusCode = 502;
    throw error;
  }
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
  response.end(JSON.stringify(value));
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);

  if (requestUrl.pathname === '/api/instagram-media') {
    try {
      sendJson(response, 200, { data: await getInstagramMedia() });
    } catch (error) {
      sendJson(response, error.statusCode || 500, { error: error.message || 'Serverfehler' });
    }
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
});