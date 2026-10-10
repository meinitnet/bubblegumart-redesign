const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { pages: subpages, renderSubpage, extractCss, galleryPageSize } = require('./subpages');
const crypto = require('node:crypto');
const sharp = require('sharp');
const esbuild = require('esbuild');

loadEnvironment();

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const siteUrl = (process.env.SITE_URL || 'https://bubblegumart.de').replace(/\/$/, '');
const imageLicenseUrl = `${siteUrl}/impressum/#bildrechte`;
const imageAcquireLicensePage = `${siteUrl}/kontakt/`;
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
  ['/videos', '/videos/'],
  ['/reels', '/videos/'],
  ['/reels/', '/videos/'],
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
// Lateinische Teilmenge als woff2, im Repo abgelegt (storage/fonts).
const bundledFonts = ['lobster-400-latin.woff2'];
const debugEnabled = /^(1|true|yes)$/i.test(process.env.DEBUG || '');
const imageDownloadConcurrency = 6;
const thumbnailWidth = 320;
const maxImageBytes = 10 * 1024 * 1024;
const maxVideoBytes = 150 * 1024 * 1024;
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
      ? deduplicateMedia(storedMedia.map(enrichMediaItem))
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

const tattooContextTags = new Set([
  'tat', 'tatoo', 'tattoo', 'tattoos', 'tattooed', 'tatt', 'tats', 'tatts',
  'ink', 'inked', 'inkd', 'inkedup', 'inkstagram', 'instatattoo',
  'tätowierung', 'tatouage', 'comictattoo', 'cutetattoo', 'colourtattoo',
  'colortattoo', 'freshtattoo', 'flashtattoo', 'flash', 'wannado',
  'wannadotattoo', 'hamburgtattoo', 'tattoohamburg', 'hamburgtattooers',
  'hamburgtattoostudio', 'germantattooers', 'femaletattooartist',
  'ladytattooers', 'mydrawing', 'comicart', 'comicartist', 'bodyart',
]);

const tattooSubjects = {
  'französischebulldogge': 'einer französischen Bulldogge',
  franchbulldog: 'einer französischen Bulldogge',
  pug: 'einem Mops',
  anker: 'einem Anker',
  anchor: 'einem Anker',
  ankertattoo: 'einem Anker',
  anchortattoo: 'einem Anker',
  ente: 'einer Ente',
  duck: 'einer Ente',
  eule: 'einer Eule',
  owl: 'einer Eule',
  katze: 'einer Katze',
  cat: 'einer Katze',
  katzentattoo: 'einer Katze',
  cattattoo: 'einer Katze',
  hund: 'einem Hund',
  dog: 'einem Hund',
  dogtattoo: 'einem Hund',
  dachs: 'einem Dachs',
  dachshund: 'einem Dackel',
  rose: 'einer Rose',
  rosen: 'Rosen',
  rosetattoo: 'einer Rose',
  flamingo: 'einem Flamingo',
  hai: 'einem Hai',
  shark: 'einem Hai',
  elefant: 'einem Elefanten',
  elephant: 'einem Elefanten',
  meerjungfrau: 'einer Meerjungfrau',
  mermaid: 'einer Meerjungfrau',
  krone: 'einer Krone',
  crown: 'einer Krone',
  schmetterling: 'einem Schmetterling',
  butterfly: 'einem Schmetterling',
  einhorn: 'einem Einhorn',
  unicorn: 'einem Einhorn',
  möwe: 'einer Möwe',
  seagull: 'einer Möwe',
  fledermaus: 'einer Fledermaus',
  bat: 'einer Fledermaus',
  dino: 'einem Dinosaurier',
  dinosaur: 'einem Dinosaurier',
  wal: 'einem Wal',
  whale: 'einem Wal',
  seepferdchen: 'einem Seepferdchen',
  seahorse: 'einem Seepferdchen',
  fisch: 'einem Fisch',
  fish: 'einem Fisch',
  kaktus: 'einem Kaktus',
  cactus: 'einem Kaktus',
  kompass: 'einem Kompass',
  compass: 'einem Kompass',
  skull: 'einem Totenkopf',
  scull: 'einem Totenkopf',
  totenkopf: 'einem Totenkopf',
  'sugarskull': 'einem Zuckerschädel',
  'girlskull': 'einem weiblichen Totenkopf',
  papierboot: 'einem Papierboot',
  lighthouse: 'einem Leuchtturm',
  leuchtturm: 'einem Leuchtturm',
  bettyboop: 'Betty Boop',
  hellokitty: 'Hello Kitty',
  minnienouse: 'Minnie Mouse',
  minniemouse: 'Minnie Mouse',
  'mickeymouse': 'Mickey Mouse',
  'popeye': 'Popeye',
  'darthvader': 'Darth Vader',
  'aliceinwonderland': 'Alice im Wunderland',
  'aliceimwunderland': 'Alice im Wunderland',
  snowwhite: 'Schneewittchen',
  schneewittchen: 'Schneewittchen',
  'littleshopofhorrors': 'einem Motiv aus Little Shop of Horrors',
  glumanda: 'Glumanda',
  minion: 'einem Minion',
  'oscar': 'Oscar aus der Sesamstraße',
  'oscardergrouch': 'Oscar aus der Sesamstraße',
  carebears: 'einem Glücksbärchi',
  glücksbärchi: 'einem Glücksbärchi',
  'jack&sally': 'Jack und Sally',
  'nightmarebeforechristmas': 'Jack und Sally',
  'lacatrina': 'La Catrina',
  mexicanskull: 'einem mexikanischen Zuckerschädel',
};

function normalizeTag(tag) {
  return String(tag || '').toLowerCase().replace(/^#/, '').trim();
}

function getHashtags(caption) {
  return [...String(caption || '').matchAll(/#[\p{L}\p{N}_-]+/gu)].map((match) => normalizeTag(match[0]));
}

function getTattooSubjects(caption) {
  return [...new Set(getHashtags(caption).map((tag) => tattooSubjects[tag]).filter(Boolean))];
}

function isTattooDesign(caption) {
  return getHashtags(caption).some((tag) => ['flash', 'flashtattoo', 'mydrawing', 'wannado', 'wannadotattoo'].includes(tag));
}

function stripHashtags(caption) {
  return cleanCaption(caption)
    .replace(/#[\p{L}\p{N}_-]+/gu, '')
    .replace(/@\w+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function createAltText(item, subjects = getTattooSubjects(item.caption)) {
  if (subjects.length) {
    const type = isTattooDesign(item.caption) ? 'Tattoo-Entwurf' : 'Tattoo';
    return `${type} von Tschiggy mit ${subjects.slice(0, 2).join(' und ')} im Bubblegum-Art-Stil`;
  }

  return stripHashtags(item.caption) || 'Instagram-Beitrag von Tschiggy';
}

function isTattooPortfolioItem(item, subjects = getTattooSubjects(item.caption)) {
  const tags = new Set(getHashtags(item.caption));
  const hasTattooContext = [...tags].some((tag) => tattooContextTags.has(tag));
  return hasTattooContext && subjects.length > 0;
}

function enrichMediaItem(item) {
  const subjects = getTattooSubjects(item.caption);
  return {
    ...item,
    caption: cleanCaption(item.caption),
    altText: createAltText(item, subjects),
    isTattooPortfolio: isTattooPortfolioItem(item, subjects),
  };
}

function deduplicateMedia(media) {
  const seen = new Set();
  return media.filter((item) => {
    const key = item.id || item.imageUrl;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

async function downloadProfileAvatar(remoteUrl, previousProfile) {
  if (!remoteUrl) return previousProfile?.avatarUrl || '';
  if (
    previousProfile?.avatarUrl?.startsWith('/instagram-media/profile-avatar.')
    && previousProfile.avatarSourceUrl === remoteUrl
    && hasStoredImage(previousProfile.avatarUrl)
  ) {
    return previousProfile.avatarUrl;
  }

  const response = await fetch(remoteUrl, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) {
    throw new Error(`Instagram-Profilbild konnte nicht geladen werden (${response.status}).`);
  }

  const { image, extension } = await readImageResponse(response, 'Instagram-Profilbild');
  const filename = `profile-avatar${extension}`;
  const targetPath = path.join(mediaDirectory, filename);
  const temporaryPath = `${targetPath}.tmp`;
  fs.writeFileSync(temporaryPath, image);

  for (const entry of fs.readdirSync(mediaDirectory)) {
    if (/^profile-avatar\.(jpg|jpeg|png|webp)$/i.test(entry) && entry !== filename) {
      fs.unlinkSync(path.join(mediaDirectory, entry));
    }
  }
  fs.renameSync(temporaryPath, targetPath);
  debugLog(`Instagram: Profilbild lokal aktualisiert (${filename})`);
  return `/instagram-media/${filename}`;
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
  const previousProfile = profileCache.value || readStoredProfile() || {};
  const avatarSourceUrl = payload.profile_picture_url || '';
  let avatarUrl = previousProfile.avatarUrl || '';
  try {
    avatarUrl = await downloadProfileAvatar(avatarSourceUrl, previousProfile);
  } catch (error) {
    debugLog(`Instagram: Profilbild-Download fehlgeschlagen: ${error.message}`);
  }

  const profile = {
    username: payload.username || 'tschiggys',
    biography: payload.biography || '',
    posts: payload.media_count ?? 0,
    followers: payload.followers_count ?? 0,
    following: payload.follows_count ?? 0,
    avatarUrl,
    avatarSourceUrl,
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

async function readImageResponse(response, label) {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxImageBytes) {
    throw new Error(`${label} ist zu gross.`);
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxImageBytes) throw new Error(`${label} ist zu gross.`);
    chunks.push(chunk);
  }

  const image = Buffer.concat(chunks, size);
  const metadata = await sharp(image).metadata();
  const extensions = { jpeg: '.jpg', png: '.png', webp: '.webp' };
  if (!extensions[metadata.format]) throw new Error(`${label} hat ein ungueltiges Bildformat.`);
  return { image, extension: extensions[metadata.format] };
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

function mediaSlug(item) {
  const subjects = getTattooSubjects(item.caption);
  if (subjects.length) {
    return `tattoo-${subjects
      .slice(0, 2)
      .join('-')
      .replace(/^(einem|einer|eines)\s+/g, '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')}`;
  }
  return captionSlug(stripHashtags(item.caption));
}

let cssCache = null;
function cachedCss() {
  return cssCache || (cssCache = extractCss());
}

function findStoredFile(id) {
  const idPattern = new RegExp(`-${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.[a-z0-9]+$`);
  return fs.readdirSync(mediaDirectory, { withFileTypes: true })
    .find((entry) => entry.isFile() && idPattern.test(entry.name));
}

async function storeImage(id, remoteUrl, item) {
  const existingFile = findStoredFile(id);
  if (existingFile) {
    const filename = `${mediaSlug(item)}-${id}${path.extname(existingFile.name)}`;
    if (existingFile.name !== filename) {
      const existingPath = path.join(mediaDirectory, existingFile.name);
      const targetPath = path.join(mediaDirectory, filename);
      if (!fs.existsSync(targetPath)) {
        fs.renameSync(existingPath, targetPath);
        const oldThumbnail = path.join(mediaDirectory, `${path.parse(existingFile.name).name}-thumb.webp`);
        const newThumbnail = path.join(mediaDirectory, `${path.parse(filename).name}-thumb.webp`);
        if (fs.existsSync(oldThumbnail) && !fs.existsSync(newThumbnail)) {
          fs.renameSync(oldThumbnail, newThumbnail);
        }
        debugLog(`Bild ${id}: Dateiname aktualisiert (${filename})`);
      }
    }
    debugLog(`Bild ${id}: Cache-Treffer (${existingFile.name})`);
    return `/instagram-media/${fs.existsSync(path.join(mediaDirectory, filename)) ? filename : existingFile.name}`;
  }

  const response = await fetch(remoteUrl, { signal: AbortSignal.timeout(30000) });
  debugLog(`Bild ${id}: Download ${response.status} ${response.statusText}`);
  if (!response.ok) throw new Error(`Bild ${id} konnte nicht gespeichert werden.`);

  const { image, extension } = await readImageResponse(response, `Bild ${id}`);
  const filename = `${mediaSlug(item)}-${id}${extension}`;
  fs.writeFileSync(path.join(mediaDirectory, filename), image);
  debugLog(`Bild ${id}: gespeichert als ${filename} (${image.length} Bytes)`);
  return `/instagram-media/${filename}`;
}

function hasStoredVideo(videoUrl) {
  if (!videoUrl?.startsWith('/instagram-media/')) return false;
  return fs.existsSync(path.join(mediaDirectory, path.basename(videoUrl)));
}

const renderedSubpages = new Map();
let videoIndexCache = { builtAt: 0, map: new Map() };

// Eine Verzeichnisabfrage alle 30 s statt einer pro Eintrag und Anfrage.
function storedVideoIndex() {
  if (Date.now() - videoIndexCache.builtAt > 30000) {
    const map = new Map();
    for (const name of fs.readdirSync(mediaDirectory)) {
      const match = /-([^-]+)-video\.mp4$/.exec(name);
      if (match) map.set(match[1], name);
    }
    videoIndexCache = { builtAt: Date.now(), map };
  }
  return videoIndexCache.map;
}

async function storeVideo(id, remoteUrl, item) {
  const filename = `${mediaSlug(item)}-${id}-video.mp4`;
  const existing = fs.readdirSync(mediaDirectory).find((name) => name.endsWith(`-${id}-video.mp4`));
  if (existing) return `/instagram-media/${existing}`;

  const response = await fetch(remoteUrl);
  if (!response.ok) throw new Error(`Video ${id} konnte nicht geladen werden (${response.status}).`);
  if (Number(response.headers.get('content-length')) > maxVideoBytes) throw new Error(`Video ${id} ist zu gross.`);

  const video = Buffer.from(await response.arrayBuffer());
  if (video.length > maxVideoBytes) throw new Error(`Video ${id} ist zu gross.`);
  const target = path.join(mediaDirectory, filename);
  fs.writeFileSync(`${target}.tmp`, video);
  fs.renameSync(`${target}.tmp`, target);
  debugLog(`Video ${id}: gespeichert als ${filename} (${video.length} Bytes)`);
  return `/instagram-media/${filename}`;
}

async function addVideo(item, remoteVideoUrl) {
  if (item.mediaType !== 'VIDEO' || hasStoredVideo(item.videoUrl)) return item;
  if (!remoteVideoUrl) return item;
  try {
    return { ...item, videoUrl: await storeVideo(item.id, remoteVideoUrl, item) };
  } catch (error) {
    debugLog(`Video ${item.id}: ${error.message}`);
    return item;
  }
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
  fs.writeFileSync(mediaIndexPath, JSON.stringify(deduplicateMedia(media.map(enrichMediaItem))));
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatIsoDateTime(value) {
  if (typeof value !== 'string') return undefined;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/);
  if (!match) return undefined;

  const [, year, month, day, hour, minute, second] = match;
  const calendarDate = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (
    !Number.isFinite(Date.parse(value))
    || calendarDate.toISOString().slice(0, 10) !== `${year}-${month}-${day}`
    || Number(hour) > 23
    || Number(minute) > 59
    || Number(second) > 59
  ) {
    return undefined;
  }

  return new Date(value).toISOString();
}

function createSitemap() {
  const media = mediaCache.value || readStoredMedia() || [];
  const imageEntry = (item) => `    <image:image>\n      <image:loc>${escapeXml(`${siteUrl}${item.imageUrl}`)}</image:loc>${item.altText ? `\n      <image:title>${escapeXml(item.altText)}</image:title>` : ''}\n    </image:image>`;
  const portfolioItems = media.filter((item) => item.isTattooPortfolio && item.imageUrl?.startsWith('/instagram-media/'));
  const portfolioPageCount = Math.max(1, Math.ceil(portfolioItems.length / galleryPageSize));
  const portfolioPageEntries = (number) => portfolioItems
    .slice((number - 1) * galleryPageSize, number * galleryPageSize)
    .map(imageEntry)
    .join('\n');
  const homepageImageEntries = portfolioItems
    .slice(0, 12)
    .map(imageEntry)
    .join('\n');
  const videoEntries = media
    .filter((item) => hasStoredVideo(item.videoUrl))
    .slice(0, 24)
    .map((item) => {
      const publicationDate = formatIsoDateTime(item.timestamp);
      return `    <video:video>\n      <video:thumbnail_loc>${escapeXml(`${siteUrl}${item.thumbnailUrl || item.imageUrl}`)}</video:thumbnail_loc>\n      <video:title>${escapeXml((item.altText || 'Tattoo-Reel von Tschiggys Bubblegum Art').slice(0, 100))}</video:title>\n      <video:description>${escapeXml((item.altText || 'Tattoo-Reel aus dem Studio Bubblegum Art in Hamburg').slice(0, 2048))}</video:description>\n      <video:content_loc>${escapeXml(`${siteUrl}${item.videoUrl}`)}</video:content_loc>${publicationDate ? `\n      <video:publication_date>${publicationDate}</video:publication_date>` : ''}\n    </video:video>`;
    })
    .join('\n');
  const fileDate = (file) => fs.statSync(path.join(__dirname, file)).mtime.toISOString().slice(0, 10);
  const latestDate = (items, fallbackFile) => {
    const times = items.map((item) => Date.parse(item.timestamp)).filter(Number.isFinite);
    return times.length ? new Date(Math.max(...times)).toISOString().slice(0, 10) : fileDate(fallbackFile);
  };
  const lastmods = {
    '/': latestDate(media, 'index.html'),
    '/portfolio/': latestDate(media.filter((item) => item.isTattooPortfolio), 'subpages.js'),
    '/videos/': latestDate(media.filter((item) => hasStoredVideo(item.videoUrl)), 'subpages.js'),
  };
  const lastmodFor = (pathname) => lastmods[pathname] || fileDate(legalPages.get(pathname) || 'subpages.js');
  const urlEntry = (loc, lastmod, extra) => `  <url>\n    <loc>${escapeXml(loc)}</loc>\n    <lastmod>${lastmod}</lastmod>${extra ? `\n${extra}` : ''}\n  </url>`;
  const legalEntries = [...Object.keys(subpages), ...legalPages.keys()]
    .flatMap((pathname) => {
      const loc = `${siteUrl}${pathname}`;
      const lastmod = lastmodFor(pathname);
      if (pathname === '/portfolio/') {
        return Array.from({ length: portfolioPageCount }, (_, index) => urlEntry(
          index ? `${loc}?page=${index + 1}` : loc,
          lastmod,
          portfolioPageEntries(index + 1),
        ));
      }
      return [urlEntry(loc, lastmod, pathname === '/videos/' ? videoEntries : '')];
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
  <url>
    <loc>${escapeXml(`${siteUrl}/`)}</loc>
    <lastmod>${lastmods['/']}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
${homepageImageEntries}
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
    .map((item) => enrichMediaItem({
      id: item.id,
      caption: cleanCaption(item.caption || 'Tattoo von @tschiggys'),
      imageUrl: item.media_type === 'VIDEO' ? item.thumbnail_url : item.media_url,
      mediaType: item.media_type,
      remoteVideoUrl: item.media_type === 'VIDEO' ? item.media_url : undefined,
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
    const { remoteVideoUrl, ...publicItem } = item;
    const existingItem = existingMedia.get(item.id);
    if (existingItem && hasStoredImage(existingItem.imageUrl)) {
      return addVideo(await addThumbnail({ ...existingItem, ...publicItem, imageUrl: existingItem.imageUrl }), remoteVideoUrl);
    }
    downloadedCount += 1;
    try {
      const imageUrl = await storeImage(item.id, item.imageUrl, item);
      return addVideo(await addThumbnail({ ...publicItem, imageUrl }), remoteVideoUrl);
    } catch (error) {
      debugLog(`Bild ${item.id}: Download fehlgeschlagen: ${error.message}`);
      throw error;
    }
  });

  const refreshedIds = new Set(refreshedMedia.map((item) => item.id));
  const olderMedia = (mediaCache.value || []).filter((item) => !refreshedIds.has(item.id));
  const media = deduplicateMedia([...refreshedMedia, ...olderMedia].map(enrichMediaItem));
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
        .catch((error) => {
          mediaCache = { ...mediaCache, expiresAt: Date.now() + 5 * 60 * 1000 };
          debugLog(`Instagram: Hintergrund-Refresh fehlgeschlagen: ${error.message}`);
        })
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

function sendText(request, response, contentType, body, cacheControl, statusCode = 200) {
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
    response.writeHead(statusCode, headers);
    response.end(body);
    return;
  }
  response.writeHead(statusCode, { ...headers, 'Content-Encoding': encoding });
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

function renderHomepage(mediaSource) {
  const portfolioMedia = (mediaSource || mediaCache.value || readStoredMedia() || [])
    .filter((item) => item.imageUrl?.startsWith('/instagram-media/') && item.isTattooPortfolio);
  const media = portfolioMedia.slice(0, 12);
  const logoImage = absoluteUrl('/storage/img/0980fd88548cae3e17e0f577e559e2cfa6710bad.webp');

  const imageObjects = portfolioMedia.map((item) => ({
    '@type': 'ImageObject',
    contentUrl: absoluteUrl(item.imageUrl),
    thumbnailUrl: absoluteUrl(item.thumbnailUrl || item.imageUrl),
    name: item.altText,
    caption: item.altText,
    uploadDate: formatIsoDateTime(item.timestamp),
    creator: { '@type': 'Organization', name: 'Tschiggy | Bubblegum art Tattoo Hamburg' },
    copyrightNotice: '© Tschiggy | Bubblegum art Tattoo Hamburg',
    creditText: 'Tschiggys Bubblegum Art Tattoo',
    acquireLicensePage: imageAcquireLicensePage,
    license: imageLicenseUrl,
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
        primaryImageOfPage: {
          '@type': 'ImageObject',
          url: logoImage,
          creator: { '@type': 'Organization', name: 'Tschiggy | Bubblegum art Tattoo Hamburg' },
          copyrightNotice: '© Tschiggy | Bubblegum art Tattoo Hamburg',
          creditText: 'Tschiggys Bubblegum Art Tattoo',
          acquireLicensePage: imageAcquireLicensePage,
          license: imageLicenseUrl,
        },
        about: { '@id': `${siteUrl}/#studio` },
        hasPart: [
          { '@type': 'WebPageElement', name: 'Instagram', url: `${siteUrl}/#instagram` },
          { '@type': 'WebPageElement', name: 'Tattoo Styles', url: `${siteUrl}/styles/` },
          { '@type': 'WebPageElement', name: 'Portfolio', url: `${siteUrl}/portfolio/` },
          { '@type': 'WebPageElement', name: 'Videos', url: `${siteUrl}/videos/` },
          { '@type': 'WebPageElement', name: 'Kontakt', url: `${siteUrl}/kontakt/` },
        ],
      },
      {
        '@type': 'SiteNavigationElement',
        name: ['Instagram', 'Styles', 'Portfolio', 'Videos', 'Kontakt', 'Impressum', 'Datenschutz'],
        url: ['/#instagram', '/styles/', '/portfolio/', '/videos/', '/kontakt/', '/impressum/', '/datenschutz/'].map(absoluteUrl),
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
    const caption = escapeXml(item.altText);
    const variant = index === 1 ? ' tall' : index === 3 ? ' wide' : '';
    return `<a class="bw3-gallery-item${variant}" href="${escapeXml(item.imageUrl)}"><img src="${escapeXml(item.thumbnailUrl || item.imageUrl)}" alt="" width="${thumbnailWidth}" height="${thumbnailWidth}" loading="lazy" decoding="async"><div class="bw3-gallery-caption">${caption}</div></a>`;
  }).join('');

  const jsonLd = JSON.stringify(graph).replace(/</g, '\\u003c');
  return minifyHtml(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'))
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, `<script type="application/ld+json">${jsonLd}</script>`)
    .replace('<div class="bw3-gallery" id="galleryGrid"></div>', `<div class="bw3-gallery" id="galleryGrid">${galleryItems}</div>`);
}

const server = http.createServer(async (request, response) => {
  const startedAt = Date.now();
  let requestUrl;
  try {
    requestUrl = new URL(request.url, 'http://localhost');
  } catch {
    sendText(request, response, 'text/plain; charset=utf-8', 'Ungueltige Anfrage.', 'no-store', 400);
    return;
  }
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
    try {
      const sourceMedia = await getInstagramMedia();
      const videoIndex = storedVideoIndex();
      let pageNumber = 1;
      if (requestUrl.pathname === '/portfolio/') {
        const portfolioCount = sourceMedia.filter((item) => item.isTattooPortfolio && item.imageUrl?.startsWith('/instagram-media/')).length;
        const totalPages = Math.max(1, Math.ceil(portfolioCount / galleryPageSize));
        const requestedPage = requestUrl.searchParams.get('page');
        pageNumber = /^[1-9]\d{0,5}$/.test(requestedPage || '') ? Number(requestedPage) : 1;
        const canonicalPage = Math.min(pageNumber, totalPages);
        const canonicalSearch = canonicalPage > 1 ? `?page=${canonicalPage}` : '';
        if (requestUrl.search !== canonicalSearch) {
          response.writeHead(301, { Location: `/portfolio/${canonicalSearch}`, 'Cache-Control': 'no-cache' });
          response.end();
          return;
        }
      }
      const cacheKey = `${requestUrl.pathname}#${pageNumber}`;
      let cached = renderedSubpages.get(cacheKey);
      if (!cached || cached.sourceMedia !== sourceMedia || cached.videoIndex !== videoIndex) {
        const media = sourceMedia.filter((item) => item.imageUrl?.startsWith('/instagram-media/'))
          .map((item) => {
            if (hasStoredVideo(item.videoUrl)) return item;
            const stored = videoIndex.get(item.id);
            return { ...item, videoUrl: stored ? `/instagram-media/${stored}` : undefined };
          });
        const rendered = minifyHtml(renderSubpage(requestUrl.pathname, {
          siteUrl,
          escape: escapeXml,
          cleanCaption,
          formatIsoDateTime,
          imageLicenseUrl,
          imageAcquireLicensePage,
          media,
          pageNumber,
          css: cachedCss(),
        }));
        cached = { sourceMedia, videoIndex, html: rendered };
        renderedSubpages.set(cacheKey, cached);
      }
      const html = cached.html;
      sendText(request, response, 'text/html; charset=utf-8', html, 'public, max-age=0, must-revalidate');
    } catch (error) {
      debugLog(`Response: ${error.statusCode || 500} nach ${Date.now() - startedAt} ms: ${error.message}`);
      sendText(request, response, 'text/plain; charset=utf-8', 'Der Dienst ist voruebergehend nicht verfuegbar.', 'no-store', error.statusCode || 500);
    }
    return;
  }

  const legalPage = legalPages.get(requestUrl.pathname);
  if (legalPage) {
    sendText(request, response, 'text/html; charset=utf-8', fs.readFileSync(path.join(__dirname, legalPage), 'utf8'), 'public, max-age=3600');
    return;
  }

  if (requestUrl.pathname === '/api/instagram-media') {
    try {
      sendJson(request, response, 200, {
        data: (await getInstagramMedia()).map(({ id, imageUrl, thumbnailUrl, videoUrl, altText, likes, comments, isTattooPortfolio }) => (
          { id, imageUrl, thumbnailUrl, videoUrl, altText, likes, comments, isTattooPortfolio }
        )),
      });
      debugLog(`Response: 200 nach ${Date.now() - startedAt} ms`);
    } catch (error) {
      debugLog(`Response: ${error.statusCode || 500} nach ${Date.now() - startedAt} ms: ${error.message}`);
      sendJson(request, response, error.statusCode || 500, { error: 'Der Dienst ist voruebergehend nicht verfuegbar.' });
    }
    return;
  }

  if (requestUrl.pathname.startsWith('/fonts/')) {
    const filename = path.basename(requestUrl.pathname);
    if (!localFonts.some((font) => font.filename === filename) && !bundledFonts.includes(filename)) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Font nicht gefunden');
      return;
    }

    response.writeHead(200, {
      'Content-Type': filename.endsWith('.woff2') ? 'font/woff2' : 'font/ttf',
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
      sendJson(request, response, error.statusCode || 500, { error: 'Der Dienst ist voruebergehend nicht verfuegbar.' });
    }
    return;
  }

  if (requestUrl.pathname === '/sitemap.xml') {
    try {
      await getInstagramMedia();
      sendText(request, response, 'application/xml; charset=utf-8', createSitemap(), 'public, max-age=3600');
    } catch (error) {
      debugLog(`Response: ${error.statusCode || 500} nach ${Date.now() - startedAt} ms: ${error.message}`);
      sendText(request, response, 'text/plain; charset=utf-8', 'Der Dienst ist voruebergehend nicht verfuegbar.', 'no-store', error.statusCode || 500);
    }
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

    const contentTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4' };
    const headers = {
      'Content-Type': contentTypes[path.extname(filename).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Accept-Ranges': 'bytes',
    };
    const size = fs.statSync(filePath).size;
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range || '');
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(size - Number(range[2]), 0);
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start > end || start >= size) {
        response.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` });
        response.end();
        return;
      }
      response.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
      fs.createReadStream(filePath, { start, end }).pipe(response);
      return;
    }
    response.writeHead(200, { ...headers, 'Content-Length': size });
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
    try {
      sendText(request, response, 'text/html; charset=utf-8', renderHomepage(await getInstagramMedia()), 'public, max-age=0, must-revalidate');
    } catch (error) {
      debugLog(`Response: ${error.statusCode || 500} nach ${Date.now() - startedAt} ms: ${error.message}`);
      sendText(request, response, 'text/plain; charset=utf-8', 'Der Dienst ist voruebergehend nicht verfuegbar.', 'no-store', error.statusCode || 500);
    }
    return;
  }

  const notFoundHtml = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Seite nicht gefunden | Bubblegum Art Tattoo Hamburg</title><meta name="robots" content="noindex"><link rel="icon" href="/favicon.ico" sizes="any"><style>body{font-family:Inter,system-ui,sans-serif;text-align:center;padding:15vh 20px;color:#333}h1{font-size:2rem;margin-bottom:12px}a{color:#ff6b6b;font-weight:600}</style></head><body><h1>Diese Seite gibt es nicht</h1><p>Die Seite wurde nicht gefunden. Hier geht es weiter:</p><p><a href="/">Startseite</a> · <a href="/styles/">Styles</a> · <a href="/portfolio/">Portfolio</a> · <a href="/videos/">Videos</a> · <a href="/kontakt/">Kontakt</a></p></body></html>`;
  sendText(request, response, 'text/html; charset=utf-8', notFoundHtml, 'no-store', 404);
});

async function startServer() {
  fs.mkdirSync(mediaDirectory, { recursive: true });
  await downloadFonts();
  server.listen(port, host, () => {
    console.log(`Bubblegum Art läuft auf http://${host}:${port}`);
    debugLog(`Konfiguration: PORT=${port}, Instagram-Zugangsdaten=${instagramUserId && instagramAccessToken ? 'gesetzt' : 'fehlen'}, LOCAL_MEDIA_ONLY=${localMediaOnly}, MEDIA_CACHE_DIR=${mediaDirectory}`);
    createStoredThumbnails().catch((error) => debugLog(`Instagram: Vorschau-Migration fehlgeschlagen: ${error.message}`));
  });
}

if (process.argv.includes('--sync-all')) {
  fs.mkdirSync(mediaDirectory, { recursive: true });
  refreshInstagramMedia(true)
    .then((media) => {
      const videos = media.filter((item) => hasStoredVideo(item.videoUrl)).length;
      console.log(`Sync abgeschlossen: ${media.length} Medien, ${videos} Videos lokal in ${mediaDirectory}`);
    })
    .catch((error) => {
      console.error(`Sync fehlgeschlagen: ${error.message}`);
      process.exitCode = 1;
    });
} else if (process.argv.includes('--rebuild-thumbnails')) {
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
