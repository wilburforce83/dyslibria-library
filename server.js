require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const compression = require('compression');
const fileUpload = require('express-fileupload');
const path = require('path');
const fs = require('fs-extra');
const chokidar = require('chokidar');
const cron = require('node-cron');
const { v2: webdav } = require('webdav-server');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const { execFile } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const SimpleJsonDB = require('simple-json-db');
const AdmZip = require('adm-zip');
const xml = require('xmlbuilder');
const {
  DEFAULT_PRESET_ID,
  convertBook,
  inspectBook,
  resolvePresetId,
  ConverterError,
  ConversionStepError
} = require('dyslibria-converter');

const {
  extractEpubData,
  upsertEpubMetadataForFile,
  removeEpubMetadataForFile,
  getEpubs,
  getEpubByFilename
} = require('./utils/epubDataUtils');
const {
  deleteLibraryBookFiles,
  listLibraryBookFilenames,
  removeReadingProgressForUserAndFilename
} = require('./utils/libraryMaintenance');
const { listUploadBookPaths } = require('./utils/uploadDiscovery');
const { createUserStore, DEFAULT_BOOTSTRAP_USERNAME, DEFAULT_BOOTSTRAP_PASSWORD } = require('./utils/userStore');
const { compareSemver, pickLatestSemver } = require('./utils/versionUtils');
const {
  buildTypographyProfileCatalog,
  importCustomTypographyProfile,
  normalizeStoredCustomTypographyProfiles,
  resolveTypographyConversionOptions,
  resolveTypographySelection
} = require('./utils/typographyProfiles');
const packageMetadata = require('./package.json');

const app = express();
const rootDir = __dirname;
const dbDir = path.join(rootDir, 'db');
const metadataCachePath = path.join(dbDir, 'epubData.json');
const sessionStorePath = path.join(dbDir, 'sessions');
fs.ensureDirSync(dbDir);
fs.ensureDirSync(sessionStorePath);
const settingsDb = new SimpleJsonDB(path.join(dbDir, 'db.json'));
const runtimeDb = new SimpleJsonDB(path.join(dbDir, 'runtime.json'));
const readingProgressDb = new SimpleJsonDB(path.join(dbDir, 'reading-progress.json'));
const userStore = createUserStore(path.join(dbDir, 'users.json'));
const sessionStore = new FileStore({
  path: sessionStorePath,
  retries: 0,
  logFn: () => {}
});

const defaultUploadsDir = path.join(rootDir, 'uploads');
const defaultProcessedDir = path.join(rootDir, 'processed');
const tempDir = path.join(rootDir, 'temp');
const incomingTempDir = path.join(tempDir, 'incoming');
const failedDir = path.join(rootDir, 'failed');

const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 200 * 1024 * 1024);
const MAX_EPUB_ARCHIVE_ENTRIES = Number(process.env.MAX_EPUB_ARCHIVE_ENTRIES || 5000);
const MAX_EPUB_EXTRACT_BYTES = Number(process.env.MAX_EPUB_EXTRACT_BYTES || 300 * 1024 * 1024);
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 20;
const APP_VERSION = String(packageMetadata.version || '0.0.0').trim() || '0.0.0';
const UPDATE_CHECK_CACHE_MS = Number.parseInt(process.env.UPDATE_CHECK_CACHE_MS || '', 10) > 0
  ? Number.parseInt(process.env.UPDATE_CHECK_CACHE_MS, 10)
  : 15 * 60 * 1000;
const UPDATE_CHECK_TIMEOUT_MS = Number.parseInt(process.env.UPDATE_CHECK_TIMEOUT_MS || '', 10) > 0
  ? Number.parseInt(process.env.UPDATE_CHECK_TIMEOUT_MS, 10)
  : 3500;
const UPDATE_CHECK_MAX_PAGES = Number.parseInt(process.env.UPDATE_CHECK_MAX_PAGES || '', 10) > 0
  ? Number.parseInt(process.env.UPDATE_CHECK_MAX_PAGES, 10)
  : 3;
const UPDATE_CHECK_NAMESPACE = String(process.env.UPDATE_CHECK_DOCKER_NAMESPACE || 'wilburforce83').trim() || 'wilburforce83';
const UPDATE_CHECK_REPOSITORY = String(process.env.UPDATE_CHECK_DOCKER_REPOSITORY || 'dyslibria').trim() || 'dyslibria';
const updateCheckState = {
  value: null,
  checkedAt: 0,
  pending: null
};

function parsePort(value, fallback, key) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
    return parsed;
  }

  if (value !== undefined && value !== null && value !== '') {
    console.warn(`Invalid port for ${key}, falling back to ${fallback}.`);
  }

  return fallback;
}

function resolveDirectorySetting(value, fallback, key) {
  if (!value) {
    return fallback;
  }

  if (!path.isAbsolute(value)) {
    console.warn(`Ignoring non-absolute ${key} setting: ${value}`);
    return fallback;
  }

  return value;
}

function normalizeBaseUrl(value) {
  if (!value) {
    return '';
  }

  const trimmedValue = String(value).trim().replace(/\/+$/, '');
  if (!trimmedValue) {
    return '';
  }

  if (/^https?:\/\//i.test(trimmedValue)) {
    return trimmedValue;
  }

  return `http://${trimmedValue}`;
}

function readConfigValue(envKey, dbKey) {
  return process.env[envKey] || (dbKey && settingsDb.has(dbKey) ? settingsDb.get(dbKey) : '');
}

const THEME_COLOR_OPTIONS = [
  { key: 'ember', label: 'Ember', hex: '#d05834' },
  { key: 'cobalt', label: 'Cobalt', hex: '#4668df' },
  { key: 'teal', label: 'Teal', hex: '#0f8c7c' },
  { key: 'gold', label: 'Gold', hex: '#b77a22' },
  { key: 'plum', label: 'Plum', hex: '#8f55b6' }
];
const THEME_COLOR_MAP = Object.fromEntries(THEME_COLOR_OPTIONS.map((option) => [option.key, option]));
const DEFAULT_THEME_COLOR = 'ember';
const CUSTOM_TYPOGRAPHY_PROFILES_KEY = 'typographyCustomProfiles';
const TYPOGRAPHY_SELECTION_KEY = 'typographyProfileSelection';

function normalizeThemeColorKey(value) {
  const normalizedValue = String(value || '').trim().toLowerCase();
  return THEME_COLOR_MAP[normalizedValue] ? normalizedValue : DEFAULT_THEME_COLOR;
}

function getThemeColorSetting() {
  return normalizeThemeColorKey(readConfigValue('THEME_COLOR', 'themeColor'));
}

function getPublicAppConfig() {
  return {
    success: true,
    currentVersion: APP_VERSION,
    defaultThemeMode: 'dark',
    themeColor: getThemeColorSetting(),
    themeColors: THEME_COLOR_OPTIONS,
    setupRequired: isSetupRequired(),
    bootstrapUsername: DEFAULT_BOOTSTRAP_USERNAME
  };
}

function readStoredCustomTypographyProfiles() {
  return normalizeStoredCustomTypographyProfiles(
    settingsDb.has(CUSTOM_TYPOGRAPHY_PROFILES_KEY)
      ? settingsDb.get(CUSTOM_TYPOGRAPHY_PROFILES_KEY)
      : []
  );
}

function persistSettingsPatch(updates) {
  settingsDb.JSON({
    ...settingsDb.JSON(),
    ...updates
  });
  settingsDb.sync();
}

function buildTypographySettingsPayload() {
  return buildTypographyProfileCatalog({
    storedSelection: settingsDb.has(TYPOGRAPHY_SELECTION_KEY)
      ? settingsDb.get(TYPOGRAPHY_SELECTION_KEY)
      : { type: 'preset', id: DEFAULT_PRESET_ID },
    storedCustomProfiles: readStoredCustomTypographyProfiles()
  });
}

function captureTypographyConversionSnapshot() {
  return resolveTypographyConversionOptions(
    settingsDb.has(TYPOGRAPHY_SELECTION_KEY)
      ? settingsDb.get(TYPOGRAPHY_SELECTION_KEY)
      : { type: 'preset', id: DEFAULT_PRESET_ID },
    readStoredCustomTypographyProfiles()
  );
}

function getDefaultUpdatePayload() {
  return {
    currentVersion: APP_VERSION,
    latestVersion: '',
    updateAvailable: false
  };
}

async function fetchLatestPublishedVersion() {
  const tags = [];
  let nextUrl = `https://hub.docker.com/v2/namespaces/${encodeURIComponent(UPDATE_CHECK_NAMESPACE)}/repositories/${encodeURIComponent(UPDATE_CHECK_REPOSITORY)}/tags?page_size=100`;
  let pageCount = 0;

  while (nextUrl && pageCount < UPDATE_CHECK_MAX_PAGES) {
    const response = await fetch(nextUrl, {
      headers: {
        accept: 'application/json'
      },
      signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS)
    });

    if (!response.ok) {
      throw new Error(`Docker Hub responded with ${response.status}.`);
    }

    const payload = await response.json();
    const pageTags = Array.isArray(payload && payload.results)
      ? payload.results.map((result) => result && result.name).filter(Boolean)
      : [];

    tags.push(...pageTags);
    nextUrl = typeof payload.next === 'string' ? payload.next : '';
    pageCount += 1;
  }

  return pickLatestSemver(tags);
}

async function getAppUpdatePayload() {
  const now = Date.now();
  if (updateCheckState.value && now - updateCheckState.checkedAt < UPDATE_CHECK_CACHE_MS) {
    return updateCheckState.value;
  }

  if (updateCheckState.pending) {
    return updateCheckState.pending;
  }

  updateCheckState.pending = (async () => {
    try {
      const latestVersion = await fetchLatestPublishedVersion();
      const payload = {
        currentVersion: APP_VERSION,
        latestVersion,
        updateAvailable: Boolean(latestVersion) && compareSemver(latestVersion, APP_VERSION) > 0
      };

      updateCheckState.value = payload;
      updateCheckState.checkedAt = Date.now();
      return payload;
    } catch (error) {
      if (!updateCheckState.value) {
        updateCheckState.value = getDefaultUpdatePayload();
      }

      updateCheckState.checkedAt = Date.now();
      console.warn(`Unable to check for Dyslibria updates: ${error.message}`);
      return updateCheckState.value;
    } finally {
      updateCheckState.pending = null;
    }
  })();

  return updateCheckState.pending;
}

const uploadsDir = resolveDirectorySetting(
  readConfigValue('UPLOAD_PATH', 'uploadPath'),
  defaultUploadsDir,
  'uploadPath'
);
const processedDir = resolveDirectorySetting(
  readConfigValue('LIBRARY_PATH', 'libraryPath'),
  defaultProcessedDir,
  'libraryPath'
);
const webdavPort = parsePort(readConfigValue('WEBDAV_PORT', 'webdavPort'), 1900, 'webdavPort');
const PORT = parsePort(readConfigValue('MAIN_PORT', 'opdsPort'), 3000, 'opdsPort');
const configuredBaseUrl = normalizeBaseUrl(readConfigValue('BASE_URL', 'baseUrl'));
const allowServerRestart = process.env.ALLOW_SERVER_RESTART === 'true';
const legacyUsername = String(process.env.WEBDAV_USERNAME || '').trim();
const legacyPassword = String(process.env.WEBDAV_PASSWORD || '').trim();

function getOrCreateSessionSecret() {
  const configuredSecret = String(process.env.SESSION_SECRET || (runtimeDb.has('sessionSecret') ? runtimeDb.get('sessionSecret') : '') || '').trim();
  if (configuredSecret) {
    if (!runtimeDb.has('sessionSecret')) {
      runtimeDb.set('sessionSecret', configuredSecret);
    }
    return configuredSecret;
  }

  const generatedSecret = crypto.randomBytes(32).toString('hex');
  runtimeDb.set('sessionSecret', generatedSecret);
  return generatedSecret;
}

const sessionSecret = getOrCreateSessionSecret();
userStore.ensureLegacyAdmin({
  username: legacyUsername,
  password: legacyPassword
});

app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(compression());

app.use(session({
  secret: sessionSecret,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: 'auto'
  }
}));

app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));

app.use(fileUpload({
  useTempFiles: true,
  tempFileDir: incomingTempDir,
  createParentPath: true,
  abortOnLimit: true,
  limits: {
    fileSize: MAX_UPLOAD_BYTES
  }
}));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

app.use(express.static(path.join(rootDir, 'public'), {
  setHeaders(res, filePath) {
    if (path.basename(filePath) === 'app-sw.js') {
      res.setHeader('Cache-Control', 'no-store');
    }
  }
}));

function isSetupRequired() {
  return !userStore.hasUsers();
}

function parseBasicAuthHeader(req) {
  const authHeader = req.get('authorization');
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return null;
  }

  try {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex === -1) {
      return null;
    }

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1)
    };
  } catch (error) {
    return null;
  }
}

function isSessionAuthenticated(req) {
  return req.session && req.session.authenticated === true;
}

function isBootstrapSession(req) {
  return isSessionAuthenticated(req) && req.session.mustSetup === true;
}

function getCurrentUser(req) {
  if (!isSessionAuthenticated(req)) {
    return null;
  }

  if (isBootstrapSession(req)) {
    return {
      id: 'bootstrap-admin',
      username: DEFAULT_BOOTSTRAP_USERNAME,
      role: 'admin',
      isActive: true,
      mustSetup: true
    };
  }

  const userId = String(req.session.userId || '').trim();
  const user = userId ? userStore.getUserById(userId) : null;
  if (!user || user.isActive === false) {
    return null;
  }

  return {
    ...user,
    mustSetup: false
  };
}

function requireSetupCompletion(req, res, next) {
  if (!isBootstrapSession(req)) {
    next();
    return;
  }

  if (String(req.path || '').startsWith('/api/')) {
    res.status(403).json({
      success: false,
      code: 'setup_required',
      message: 'Initial setup must be completed before using Dyslibria.'
    });
    return;
  }

  res.redirect('/authenticated/settings.html?setup=1');
}

function shouldRedirectToLogin(req) {
  const extension = path.extname(String(req.path || '')).toLowerCase();
  if (extension && extension !== '.html') {
    return false;
  }

  const fetchDest = req.get('sec-fetch-dest');
  if (fetchDest && !['document', 'iframe', 'empty'].includes(fetchDest)) {
    return false;
  }

  if (String(req.path || '').startsWith('/api/')) {
    return false;
  }

  return Boolean(req.accepts('html'));
}

function respondUnauthenticated(req, res) {
  if (shouldRedirectToLogin(req)) {
    res.redirect('/login');
    return;
  }

  if (String(req.path || '').startsWith('/api/') || req.accepts('json')) {
    res.status(401).json({ success: false, message: 'Authentication required.' });
    return;
  }

  res.status(401).type('text/plain').send('Authentication required.');
}

function isAuthenticated(req, res, next) {
  if (getCurrentUser(req)) {
    next();
    return;
  }

  if (req.session) {
    req.session.destroy(() => {
      respondUnauthenticated(req, res);
    });
    return;
  }

  respondUnauthenticated(req, res);
}

function requireCatalogAuth(req, res, next) {
  const currentUser = getCurrentUser(req);
  if (currentUser) {
    if (currentUser.mustSetup) {
      res.status(403).json({ success: false, message: 'Initial setup must be completed before accessing the catalog.' });
      return;
    }

    next();
    return;
  }

  const credentials = parseBasicAuthHeader(req);
  const authenticated = credentials
    ? userStore.authenticate(credentials.username, credentials.password)
    : null;

  if (authenticated && authenticated.type === 'user') {
    next();
    return;
  }

  res.set('WWW-Authenticate', 'Basic realm="Dyslibria Catalog"');
  res.status(401).json({ success: false, message: 'Authentication required.' });
}

function createRateLimiter({ windowMs, maxAttempts, keyFn }) {
  const attempts = new Map();

  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    const timestamps = (attempts.get(key) || []).filter((timestamp) => now - timestamp < windowMs);

    if (timestamps.length >= maxAttempts) {
      res.status(429).json({ success: false, message: 'Too many requests. Please try again later.' });
      return;
    }

    timestamps.push(now);
    attempts.set(key, timestamps);
    next();
  };
}

const loginRateLimiter = createRateLimiter({
  windowMs: LOGIN_WINDOW_MS,
  maxAttempts: LOGIN_MAX_ATTEMPTS,
  keyFn: (req) => req.ip
});

function requireAdmin(req, res, next) {
  const user = getCurrentUser(req);
  if (!user) {
    respondUnauthenticated(req, res);
    return;
  }

  if (user.role !== 'admin') {
    res.status(403).json({ success: false, message: 'Administrator access required.' });
    return;
  }

  if (user.mustSetup) {
    res.status(403).json({ success: false, code: 'setup_required', message: 'Complete initial setup first.' });
    return;
  }

  next();
}

function sanitizeFileStem(fileName) {
  const extension = path.extname(fileName);
  const baseName = path.basename(fileName, extension);
  const sanitized = baseName
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);

  return sanitized || 'book';
}

function sanitizeEpubFilename(requestedFilename) {
  const filename = path.basename(String(requestedFilename || ''));

  if (filename !== requestedFilename || path.extname(filename).toLowerCase() !== '.epub') {
    return null;
  }

  return filename;
}

function buildBookCoverUrl(epub) {
  const filename = String(epub && epub.filename || '');
  if (!filename) {
    return '';
  }

  const version = encodeURIComponent([
    String(epub.coverVersion || ''),
    String(epub.lastModified || ''),
    String(epub.fileSizeBytes || '')
  ].filter(Boolean).join(':'));
  return `/api/books/${encodeURIComponent(filename)}/cover${version ? `?v=${version}` : ''}`;
}

function toCatalogBook(epub) {
  const entry = epub && typeof epub === 'object' ? epub : {};

  return {
    filename: entry.filename || '',
    title: entry.title || '',
    author: entry.author || '',
    lastModified: entry.lastModified || '',
    isValid: entry.isValid !== false,
    processingError: entry.processingError || '',
    coverUrl: buildBookCoverUrl(entry)
  };
}

function parseDataUriPayload(value) {
  const match = String(value || '').match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) {
    return null;
  }

  try {
    return {
      mimeType: match[1],
      buffer: Buffer.from(match[2], 'base64')
    };
  } catch (error) {
    return null;
  }
}

function getReadingProgressUser(req) {
  const currentUser = getCurrentUser(req);
  if (currentUser) {
    return currentUser;
  }

  return null;
}

function getReadingProgressKey(user, filename) {
  return `${user.id}::${filename}`;
}

function readStoredProgress(user, filename) {
  if (!user) {
    return null;
  }

  const directMatch = readingProgressDb.get(getReadingProgressKey(user, filename));
  if (directMatch && typeof directMatch === 'object') {
    return directMatch;
  }

  const legacyMatch = readingProgressDb.get(`${user.username}::${filename}`);
  if (legacyMatch && typeof legacyMatch === 'object') {
    return legacyMatch;
  }

  return null;
}

function replaceReadingProgressEntries(nextEntries) {
  readingProgressDb.JSON(nextEntries);
  readingProgressDb.sync();
}

function sanitizeProgressPayload(payload) {
  const location = typeof payload.location === 'string' ? payload.location.trim() : '';
  if (!location || location.length > 4096) {
    throw new Error('A valid reading location is required.');
  }

  const progressPercent = Number(payload.progressPercent);
  const safeProgressPercent = Number.isFinite(progressPercent)
    ? Math.max(0, Math.min(100, Math.round(progressPercent)))
    : 0;

  const pageNumber = Number(payload.pageNumber);
  const totalPages = Number(payload.totalPages);

  return {
    location,
    progressPercent: safeProgressPercent,
    chapterLabel: String(payload.chapterLabel || '').trim().slice(0, 400),
    pageLabel: String(payload.pageLabel || '').trim().slice(0, 200),
    pageNumber: Number.isFinite(pageNumber) && pageNumber > 0 ? Math.round(pageNumber) : null,
    totalPages: Number.isFinite(totalPages) && totalPages > 0 ? Math.round(totalPages) : null,
    href: String(payload.href || '').trim().slice(0, 400),
    title: String(payload.title || '').trim().slice(0, 300),
    author: String(payload.author || '').trim().slice(0, 300)
  };
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) {
      return true;
    }

    if (['false', '0', 'no', 'off'].includes(normalized)) {
      return false;
    }
  }

  return fallback;
}

const queuedUploadPaths = new Set();
const queuedOutputFilenames = new Set();
const watcherIgnoredPaths = new Set();
const fileQueue = [];
const conversionLogs = [];
let isProcessing = false;
let metadataRefreshInFlight = false;
let metadataTaskChain = Promise.resolve();

function appendConversionLog(level, message) {
  conversionLogs.push({
    id: uuidv4(),
    level,
    message,
    timestamp: new Date().toISOString()
  });

  if (conversionLogs.length > 250) {
    conversionLogs.splice(0, conversionLogs.length - 250);
  }
}

function getRuntimeStatus() {
  return {
    processing: isProcessing,
    queueLength: fileQueue.length,
    logs: conversionLogs.slice().reverse()
  };
}

async function getMetadataStatus() {
  try {
    const metadataReady = await fs.pathExists(metadataCachePath);
    if (!metadataReady) {
      return {
        ready: false,
        refreshing: metadataRefreshInFlight,
        updatedAtMs: 0
      };
    }

    const fileStat = await fs.stat(metadataCachePath);
    return {
      ready: true,
      refreshing: metadataRefreshInFlight,
      updatedAtMs: Math.round(fileStat.mtimeMs)
    };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return {
        ready: false,
        refreshing: metadataRefreshInFlight,
        updatedAtMs: 0
      };
    }

    throw error;
  }
}

async function getMetadataReady() {
  const metadataStatus = await getMetadataStatus();
  return metadataStatus.ready;
}

function enqueueMetadataTask(task) {
  metadataTaskChain = metadataTaskChain.then(task, task);
  return metadataTaskChain;
}

async function refreshLibraryMetadata(options = {}) {
  return enqueueMetadataTask(async () => {
    metadataRefreshInFlight = true;

    try {
      return await extractEpubData(processedDir, {
        cachePath: metadataCachePath,
        force: options.force
      });
    } finally {
      metadataRefreshInFlight = false;
    }
  });
}

function refreshLibraryMetadataInBackground(options = {}) {
  void refreshLibraryMetadata(options).catch((error) => {
    console.error('Error refreshing library metadata:', error);
    appendConversionLog('error', `Library metadata refresh failed: ${error.message}`);
  });
}

async function upsertLibraryMetadataForFile(filename) {
  return enqueueMetadataTask(() => upsertEpubMetadataForFile(processedDir, filename, {
    cachePath: metadataCachePath
  }));
}

async function removeLibraryMetadataForFile(filename) {
  return enqueueMetadataTask(() => removeEpubMetadataForFile(filename, {
    cachePath: metadataCachePath
  }));
}

async function ensureDirectoriesExist() {
  await fs.ensureDir(uploadsDir);
  await fs.ensureDir(processedDir);
  await fs.ensureDir(tempDir);
  await fs.ensureDir(incomingTempDir);
  await fs.ensureDir(failedDir);
  await fs.ensureDir(path.join(rootDir, 'db'));
}

function getConverterError(error) {
  let currentError = error;

  while (currentError) {
    if (currentError instanceof ConverterError) {
      return currentError;
    }

    currentError = currentError.cause;
  }

  return null;
}

function getConversionFailureMessage(error) {
  const converterError = getConverterError(error);
  if (!converterError) {
    return error instanceof Error && error.message
      ? error.message
      : 'The EPUB conversion pipeline failed.';
  }

  if (
    converterError instanceof ConversionStepError &&
    converterError.cause instanceof Error &&
    converterError.cause.message &&
    converterError.cause.message !== converterError.message
  ) {
    return converterError.cause.message;
  }

  return converterError.message || 'The EPUB conversion pipeline failed.';
}

function appendConverterEventLog(filename, event) {
  if (!event || event.level === 'debug') {
    return;
  }

  const level = event.level === 'warn' ? 'info' : event.level;
  const step = String(event.step || '').trim();
  const stepPrefix = step ? `[${step}] ` : '';
  appendConversionLog(level, `${stepPrefix}${filename}: ${event.message}`);
}

async function validateUploadedEpub(epubFile) {
  if (!epubFile || !epubFile.tempFilePath) {
    throw new Error('No uploaded file data was found.');
  }

  if (path.extname(epubFile.name || '').toLowerCase() !== '.epub') {
    throw new Error('Only .epub files are supported.');
  }

  try {
    const zip = new AdmZip(epubFile.tempFilePath);
    const entries = zip.getEntries();

    if (entries.length > MAX_EPUB_ARCHIVE_ENTRIES) {
      throw new Error(`The EPUB archive contains too many entries (${entries.length}).`);
    }
  } catch (error) {
    throw new Error(getConversionFailureMessage(error));
  }

  try {
    await inspectBook(epubFile.tempFilePath);
  } catch (error) {
    throw new Error(getConversionFailureMessage(error));
  }
}

async function allocateOutputFilename(originalName) {
  const stem = sanitizeFileStem(originalName);
  let candidate = `${stem}.epub`;
  let suffix = 1;

  while (
    queuedOutputFilenames.has(candidate) ||
    (await fs.pathExists(path.join(processedDir, candidate)))
  ) {
    candidate = `${stem}-${suffix}.epub`;
    suffix += 1;
  }

  return candidate;
}

function enqueueFile(job) {
  if (queuedUploadPaths.has(job.uploadPath) || queuedOutputFilenames.has(job.outputFilename)) {
    return false;
  }

  queuedUploadPaths.add(job.uploadPath);
  queuedOutputFilenames.add(job.outputFilename);
  fileQueue.push(job);

  if (!isProcessing) {
    void processNextFile();
  }

  appendConversionLog(
    'info',
    `Queued ${job.outputFilename} for conversion using ${job.typographyProfile.label}.`
  );

  return true;
}

async function quarantineFailedUpload(job) {
  const quarantinePath = path.join(
    failedDir,
    `${path.basename(job.outputFilename, '.epub')}-${job.id}.epub`
  );

  if (await fs.pathExists(job.uploadPath)) {
    await fs.move(job.uploadPath, quarantinePath, { overwrite: true });
  }
}

async function processEpubJob(job) {
  let quarantined = false;
  const finalOutputPath = path.join(processedDir, job.outputFilename);

  try {
    console.log(`Starting to process EPUB file: ${job.uploadPath}`);
    appendConversionLog(
      'info',
      `Starting conversion for ${job.outputFilename} with ${job.typographyProfile.label}.`
    );

    await ensureDirectoriesExist();
    const result = await convertBook(job.uploadPath, {
      outputPath: finalOutputPath,
      optimizeImages: true,
      returnBuffer: false,
      tempRootDir: tempDir,
      maxArchiveEntries: MAX_EPUB_ARCHIVE_ENTRIES,
      maxExtractBytes: MAX_EPUB_EXTRACT_BYTES,
      ...job.typographyProfile.convertOptions,
      logger: (event) => appendConverterEventLog(job.outputFilename, event)
    });

    await upsertLibraryMetadataForFile(job.outputFilename);
    console.log(`Successfully processed: ${job.uploadPath}`);
    appendConversionLog(
      'success',
      `Finished converting ${job.outputFilename} with ${job.typographyProfile.label} (${result.stats.processedFiles} content file${result.stats.processedFiles === 1 ? '' : 's'} in ${result.stats.durationMs} ms).`
    );
  } catch (error) {
    const message = getConversionFailureMessage(error);
    console.error(`Error processing EPUB ${job.uploadPath}: ${message}`, error);
    appendConversionLog('error', `Failed converting ${job.outputFilename}: ${message}`);
    await fs.remove(finalOutputPath);
    await quarantineFailedUpload(job);
    quarantined = true;
  } finally {
    queuedUploadPaths.delete(job.uploadPath);
    queuedOutputFilenames.delete(job.outputFilename);

    if (!quarantined) {
      await fs.remove(job.uploadPath);
    }
  }
}

async function processNextFile() {
  if (isProcessing) {
    return;
  }

  const nextJob = fileQueue.shift();
  if (!nextJob) {
    return;
  }

  isProcessing = true;

  try {
    await processEpubJob(nextJob);
  } finally {
    isProcessing = false;

    if (fileQueue.length > 0) {
      setTimeout(() => {
        void processNextFile();
      }, 250);
    }
  }
}

async function handleWatchedUpload(filePath) {
  if (watcherIgnoredPaths.has(filePath)) {
    watcherIgnoredPaths.delete(filePath);
    return;
  }

  if (path.extname(filePath).toLowerCase() !== '.epub') {
    return;
  }

  const outputFilename = await allocateOutputFilename(path.basename(filePath));
  const typographyProfile = captureTypographyConversionSnapshot();
  enqueueFile({
    id: uuidv4(),
    uploadPath: filePath,
    outputFilename,
    typographyProfile
  });
  appendConversionLog('info', `Detected new upload ${path.basename(filePath)}.`);
}

function startUploadsWatcher() {
  chokidar.watch(uploadsDir, {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 100
    }
  }).on('add', (filePath) => {
    void handleWatchedUpload(filePath);
  });
}

async function queueExistingUploads() {
  const existingUploadPaths = await listUploadBookPaths(uploadsDir);
  let recoveredCount = 0;

  for (const uploadPath of existingUploadPaths) {
    const outputFilename = await allocateOutputFilename(path.basename(uploadPath));
    const typographyProfile = captureTypographyConversionSnapshot();
    const didQueue = enqueueFile({
      id: uuidv4(),
      uploadPath,
      outputFilename,
      typographyProfile
    });

    if (didQueue) {
      recoveredCount += 1;
    }
  }

  if (recoveredCount > 0) {
    appendConversionLog(
      'info',
      `Recovered ${recoveredCount} pending upload${recoveredCount === 1 ? '' : 's'} from the uploads folder on startup.`
    );
  }
}

function getBaseUrl(req) {
  return configuredBaseUrl || `${req.protocol}://${req.get('host')}`;
}

function createStableId(value) {
  return crypto.createHash('sha1').update(value).digest('hex');
}

function createOpdsFeed(epubs, baseUrl) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  const feedId = `urn:sha1:${createStableId(`${normalizedBaseUrl}:${processedDir}`)}`;
  const feed = xml.create('feed', { encoding: 'UTF-8' })
    .att('xmlns', 'http://www.w3.org/2005/Atom')
    .att('xmlns:dc', 'http://purl.org/dc/terms/')
    .att('xmlns:opds', 'http://opds-spec.org/2010/catalog')
    .ele('title', 'Dyslibria Library').up()
    .ele('id', feedId).up()
    .ele('updated', new Date().toISOString()).up()
    .ele('author')
      .ele('name', 'Dyslibria').up()
    .up()
    .ele('link')
      .att('rel', 'self')
      .att('href', `${normalizedBaseUrl}/opds`)
      .att('type', 'application/atom+xml;profile=opds-catalog;kind=navigation').up()
    .ele('link')
      .att('rel', 'start')
      .att('href', `${normalizedBaseUrl}/opds`)
      .att('type', 'application/atom+xml;profile=opds-catalog;kind=navigation').up();

  epubs.forEach((epub) => {
    const lastModified = new Date(epub.lastModified);
    const validLastModified = Number.isNaN(lastModified.getTime()) ? new Date() : lastModified;
    const entryId = `urn:sha1:${createStableId(epub.filename)}`;

    const entry = feed.ele('entry');
    entry.ele('title', epub.title || epub.filename).up();

    if (epub.author) {
      entry.ele('author').ele('name', epub.author).up().up();
    }

    entry.ele('id', entryId).up();
    entry.ele('updated', validLastModified.toISOString()).up();
    entry.ele('content', { type: 'text' }, `Available: ${epub.filename}`).up();
    entry.ele('link')
      .att('rel', 'http://opds-spec.org/acquisition/open-access')
      .att('href', `${normalizedBaseUrl}/epub/${encodeURIComponent(epub.filename)}`)
      .att('type', 'application/epub+zip').up();
  });

  return feed.end({ pretty: true });
}

function normalizeSettingsUpdate(payload) {
  const updates = {};

  if (payload.webdavPort !== undefined) {
    updates.webdavPort = String(parsePort(payload.webdavPort, webdavPort, 'webdavPort'));
  }

  if (payload.opdsPort !== undefined) {
    updates.opdsPort = String(parsePort(payload.opdsPort, PORT, 'opdsPort'));
  }

  if (payload.uploadPath !== undefined) {
    const uploadPath = String(payload.uploadPath || '').trim();
    if (uploadPath && !path.isAbsolute(uploadPath)) {
      throw new Error('Upload path must be absolute.');
    }

    updates.uploadPath = uploadPath;
  }

  if (payload.libraryPath !== undefined) {
    const libraryPath = String(payload.libraryPath || '').trim();
    if (libraryPath && !path.isAbsolute(libraryPath)) {
      throw new Error('Library path must be absolute.');
    }

    updates.libraryPath = libraryPath;
  }

  if (payload.baseUrl !== undefined) {
    updates.baseUrl = normalizeBaseUrl(payload.baseUrl);
  }

  if (payload.themeColor !== undefined) {
    updates.themeColor = normalizeThemeColorKey(payload.themeColor);
  }

  return updates;
}

// Basic route to serve the login page
app.get('/healthz', async (req, res) => {
  const metadataStatus = await getMetadataStatus();

  res.json({
    status: 'ok',
    processing: isProcessing,
    queueLength: fileQueue.length,
    metadataReady: metadataStatus.ready,
    metadataRefreshing: metadataStatus.refreshing,
    metadataUpdatedAtMs: metadataStatus.updatedAtMs
  });
});

app.get('/api/app-config', (req, res) => {
  res.json(getPublicAppConfig());
});

app.get('/api/update-status', requireAdmin, async (req, res) => {
  res.json({
    success: true,
    ...(await getAppUpdatePayload())
  });
});

app.get('/api/session', isAuthenticated, (req, res) => {
  const user = getCurrentUser(req);
  if (!user) {
    res.status(401).json({ success: false, message: 'Authentication required.' });
    return;
  }

  res.json({
    success: true,
    user,
    setupRequired: isSetupRequired(),
    canManageUsers: user.role === 'admin',
    canManageSystem: user.role === 'admin' && !user.mustSetup
  });
});

app.get('/api/system-status', isAuthenticated, async (req, res) => {
  const metadataStatus = await getMetadataStatus();
  const runtimeStatus = getRuntimeStatus();
  res.json({
    success: true,
    metadataReady: metadataStatus.ready,
    metadataRefreshing: metadataStatus.refreshing,
    metadataUpdatedAtMs: metadataStatus.updatedAtMs,
    processing: runtimeStatus.processing,
    queueLength: runtimeStatus.queueLength,
    logCount: runtimeStatus.logs.length,
    latestLog: runtimeStatus.logs[0] || null
  });
});

app.get('/api/conversion-logs', requireAdmin, (req, res) => {
  res.json({
    success: true,
    logs: getRuntimeStatus().logs
  });
});

app.delete('/api/conversion-logs', requireAdmin, (req, res) => {
  conversionLogs.length = 0;
  res.json({ success: true });
});

app.get('/login', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

   if (isSessionAuthenticated(req)) {
    if (isBootstrapSession(req)) {
      res.redirect('/authenticated/settings.html?setup=1');
      return;
    }

    res.redirect('/authenticated/index.html');
    return;
  }

  res.sendFile(path.join(rootDir, 'public', 'login.html'));
});

// Handle login
app.post('/login', loginRateLimiter, async (req, res) => {
  const { username = '', password = '' } = req.body;

  const authenticated = userStore.authenticate(username, password);
  if (!authenticated) {
    res.redirect('/login');
    return;
  }

  req.session.regenerate((error) => {
    if (error) {
      console.error('Error regenerating session after login:', error);
      res.status(500).send('Unable to start session.');
      return;
    }

    req.session.authenticated = true;
    req.session.userId = authenticated.user.id;
    req.session.username = authenticated.user.username;
    req.session.role = authenticated.user.role;
    req.session.mustSetup = authenticated.type === 'bootstrap';
    req.session.save((saveError) => {
      if (saveError) {
        console.error('Error saving session after login:', saveError);
        res.status(500).send('Unable to persist session.');
        return;
      }

      if (authenticated.type === 'user') {
        userStore.recordLogin(authenticated.user.id);
      }

      res.redirect(authenticated.type === 'bootstrap'
        ? '/authenticated/settings.html?setup=1'
        : '/authenticated/index.html');
    });
  });
});

app.post('/logout', isAuthenticated, (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

app.post('/api/setup/admin', isAuthenticated, (req, res) => {
  if (!isBootstrapSession(req) || !isSetupRequired()) {
    res.status(400).json({ success: false, message: 'Initial setup is not available.' });
    return;
  }

  try {
    const user = userStore.createInitialAdmin({
      username: req.body.username,
      password: req.body.password
    });

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;
    req.session.mustSetup = false;
    userStore.recordLogin(user.id);
    req.session.save((error) => {
      if (error) {
        console.error('Error saving session after initial setup:', error);
        res.status(500).json({ success: false, message: 'Initial setup completed, but the session could not be refreshed.' });
        return;
      }

      res.json({ success: true, user });
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message || 'Unable to create the first administrator account.' });
  }
});

app.get('/api/users', requireAdmin, (req, res) => {
  res.json({
    success: true,
    users: userStore.listUsers()
  });
});

app.post('/api/users', requireAdmin, (req, res) => {
  try {
    const user = userStore.createUser({
      username: req.body.username,
      password: req.body.password,
      role: req.body.role
    });

    res.status(201).json({ success: true, user });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message || 'Unable to create the user account.' });
  }
});

app.patch('/api/users/:id', requireAdmin, (req, res) => {
  try {
    const user = userStore.updateUser(req.params.id, {
      role: req.body.role,
      isActive: req.body.isActive !== undefined ? normalizeBoolean(req.body.isActive, true) : undefined,
      password: req.body.password
    });

    res.json({ success: true, user });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message || 'Unable to update the user account.' });
  }
});

app.delete('/api/users/:id', requireAdmin, (req, res) => {
  if (String(req.session.userId || '') === String(req.params.id || '')) {
    res.status(400).json({ success: false, message: 'Delete the current account from another administrator session instead.' });
    return;
  }

  try {
    userStore.deleteUser(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message || 'Unable to remove the user account.' });
  }
});

app.post('/api/account/password', isAuthenticated, (req, res) => {
  if (isBootstrapSession(req)) {
    res.status(400).json({ success: false, message: 'Complete initial setup before changing passwords.' });
    return;
  }

  const currentUser = getCurrentUser(req);
  if (!currentUser) {
    res.status(401).json({ success: false, message: 'Authentication required.' });
    return;
  }

  try {
    userStore.updateOwnPassword(currentUser.id, req.body.currentPassword, req.body.newPassword);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message || 'Unable to update the password.' });
  }
});

// Root route that redirects to login if not authenticated
app.get('/', isAuthenticated, (req, res) => {
  res.redirect(isBootstrapSession(req) ? '/authenticated/settings.html?setup=1' : '/authenticated/index.html');
});

function allowAuthenticatedAssetDuringSetup(requestPath) {
  if (!requestPath) {
    return false;
  }

  if (requestPath === '/settings.html' || requestPath === '/settings.css' || requestPath === '/settings.js') {
    return true;
  }

  return path.extname(requestPath).toLowerCase() !== '.html';
}

function guardAuthenticatedStatic(req, res, next) {
  if (!isSessionAuthenticated(req)) {
    respondUnauthenticated(req, res);
    return;
  }

  if (!isBootstrapSession(req)) {
    next();
    return;
  }

  if (allowAuthenticatedAssetDuringSetup(String(req.path || ''))) {
    next();
    return;
  }

  res.redirect('/authenticated/settings.html?setup=1');
}

// Serve authenticated content
app.use('/authenticated', guardAuthenticatedStatic, express.static(path.join(rootDir, 'authenticated'), {
  setHeaders(res, filePath) {
    if (/\.(?:html|css|js)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store');
    }
  }
}));
app.use('/processed', requireCatalogAuth, express.static(processedDir));

// Route to get the list of EPUBs
app.get('/epubs', requireCatalogAuth, async (req, res) => {
  try {
    const metadataStatus = await getMetadataStatus();
    const epubs = (await getEpubs({ cachePath: metadataCachePath }))
      .map(toCatalogBook);

    epubs.sort((a, b) => {
      const authorA = a.author || '';
      const authorB = b.author || '';
      return authorA.localeCompare(authorB);
    });
    res.setHeader('X-Dyslibria-Metadata-Ready', metadataStatus.ready ? '1' : '0');
    res.setHeader('X-Dyslibria-Metadata-Refreshing', metadataStatus.refreshing ? '1' : '0');
    res.setHeader('X-Dyslibria-Metadata-Updated-At', String(metadataStatus.updatedAtMs || 0));
    res.json(epubs);
  } catch (err) {
    console.error('Error fetching EPUBs:', err);
    res.status(500).json({ success: false, message: 'Error fetching EPUBs.' });
  }
});

app.get('/api/books/:filename/cover', requireCatalogAuth, async (req, res) => {
  const filename = sanitizeEpubFilename(req.params.filename);

  if (!filename) {
    res.status(400).json({ success: false, message: 'Invalid EPUB file name.' });
    return;
  }

  try {
    const book = await getEpubByFilename(filename, {
      includeInvalid: true,
      cachePath: metadataCachePath
    });
    if (!book) {
      res.status(404).json({ success: false, message: 'Cover not found.' });
      return;
    }

    const coverAsset = parseDataUriPayload(book.cover);
    if (!coverAsset) {
      res.status(404).json({ success: false, message: 'Cover not found.' });
      return;
    }

    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader(
      'ETag',
      `"${createStableId(`${filename}:${book.coverVersion || ''}:${book.lastModified || ''}:${String(book.cover || '').length}`)}"`
    );
    res.type(coverAsset.mimeType);
    res.send(coverAsset.buffer);
  } catch (error) {
    console.error('Error fetching EPUB cover:', error);
    res.status(500).json({ success: false, message: 'Unable to load the cover image.' });
  }
});

// Route to serve EPUB files
app.get('/epub/:filename', requireCatalogAuth, async (req, res) => {
  const filename = sanitizeEpubFilename(req.params.filename);

  if (!filename) {
    res.status(400).json({ success: false, message: 'Invalid EPUB file name.' });
    return;
  }

  res.sendFile(filename, { root: processedDir }, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ success: false, message: 'EPUB file not found.' });
    }
  });
});

app.get('/api/reading-progress', isAuthenticated, async (req, res) => {
  const currentUser = getReadingProgressUser(req);
  if (!currentUser) {
    res.status(401).json({ success: false, message: 'Authentication required.' });
    return;
  }

  try {
    const availableBooks = await getEpubs({
      includeInvalid: true,
      cachePath: metadataCachePath
    });
    const availableFilenames = new Set(availableBooks.map((entry) => entry.filename));
    const entries = Object.values(readingProgressDb.JSON())
      .filter((entry) => entry && entry.filename && availableFilenames.has(entry.filename) && (
        entry.userId === currentUser.id ||
        entry.userId === currentUser.username ||
        entry.username === currentUser.username
      ))
      .sort((left, right) => {
        const leftTime = Date.parse(left.updatedAt || 0) || 0;
        const rightTime = Date.parse(right.updatedAt || 0) || 0;
        return rightTime - leftTime;
      });

    res.json({
      success: true,
      progress: entries
    });
  } catch (error) {
    console.error('Error loading reading progress:', error);
    res.status(500).json({ success: false, message: 'Unable to load reading progress.' });
  }
});

app.get('/api/reading-progress/:filename', isAuthenticated, (req, res) => {
  const filename = sanitizeEpubFilename(req.params.filename);

  if (!filename) {
    res.status(400).json({ success: false, message: 'Invalid EPUB file name.' });
    return;
  }

  const currentUser = getReadingProgressUser(req);
  const progress = readStoredProgress(currentUser, filename);
  res.json({ success: true, progress });
});

app.post('/api/reading-progress/:filename', isAuthenticated, async (req, res) => {
  const filename = sanitizeEpubFilename(req.params.filename);

  if (!filename) {
    res.status(400).json({ success: false, message: 'Invalid EPUB file name.' });
    return;
  }

  const epubPath = path.join(processedDir, filename);
  if (!(await fs.pathExists(epubPath))) {
    res.status(404).json({ success: false, message: 'EPUB file not found.' });
    return;
  }

  try {
    const sanitizedProgress = sanitizeProgressPayload(req.body || {});
    const currentUser = getReadingProgressUser(req);
    if (!currentUser) {
      res.status(401).json({ success: false, message: 'Authentication required.' });
      return;
    }

    const storedRecord = {
      ...sanitizedProgress,
      filename,
      userId: currentUser.id,
      username: currentUser.username,
      updatedAt: new Date().toISOString()
    };

    readingProgressDb.set(getReadingProgressKey(currentUser, filename), storedRecord);
    res.json({ success: true, progress: storedRecord });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message || 'Invalid reading progress payload.' });
  }
});

app.delete('/api/reading-progress/:filename', isAuthenticated, (req, res) => {
  const filename = sanitizeEpubFilename(req.params.filename);

  if (!filename) {
    res.status(400).json({ success: false, message: 'Invalid EPUB file name.' });
    return;
  }

  const currentUser = getReadingProgressUser(req);
  if (!currentUser) {
    res.status(401).json({ success: false, message: 'Authentication required.' });
    return;
  }

  const result = removeReadingProgressForUserAndFilename(readingProgressDb.JSON(), currentUser, filename);
  replaceReadingProgressEntries(result.nextEntries);

  res.json({
    success: true,
    removedCount: result.removedCount
  });
});

app.delete('/api/books/:filename', requireAdmin, async (req, res) => {
  const filename = sanitizeEpubFilename(req.params.filename);

  if (!filename) {
    res.status(400).json({ success: false, message: 'Invalid EPUB file name.' });
    return;
  }

  try {
    const deletedFilenames = await deleteLibraryBookFiles(processedDir, [filename]);

    if (!deletedFilenames.length) {
      res.status(404).json({ success: false, message: 'Book not found in the library.' });
      return;
    }

    await removeLibraryMetadataForFile(filename);
    appendConversionLog('info', `Deleted library book ${filename}.`);

    res.json({
      success: true,
      deletedCount: deletedFilenames.length,
      deletedFilenames
    });
  } catch (error) {
    console.error('Error deleting library book:', error);
    res.status(500).json({ success: false, message: 'Unable to delete the book.' });
  }
});

app.delete('/api/books', requireAdmin, async (req, res) => {
  const removeReadingProgress = normalizeBoolean(req.body && req.body.removeReadingProgress, true);

  try {
    const filenames = await listLibraryBookFilenames(processedDir);
    const deletedFilenames = await deleteLibraryBookFiles(processedDir, filenames);

    if (removeReadingProgress) {
      replaceReadingProgressEntries({});
    }

    await refreshLibraryMetadata();
    appendConversionLog(
      'info',
      `Deleted ${deletedFilenames.length} library book${deletedFilenames.length === 1 ? '' : 's'}${removeReadingProgress ? ' and cleared all reading progress.' : '.'}`
    );

    res.json({
      success: true,
      deletedCount: deletedFilenames.length,
      deletedFilenames,
      removedReadingProgress: removeReadingProgress
    });
  } catch (error) {
    console.error('Error clearing library:', error);
    res.status(500).json({ success: false, message: 'Unable to delete the library contents.' });
  }
});

// Route to update the EPUB database
app.post('/update-database', requireAdmin, async (req, res) => {
  try {
    appendConversionLog('info', 'Manual library refresh requested.');
    await refreshLibraryMetadata({ force: true });
    appendConversionLog('success', 'Library metadata refresh completed.');
    res.json({ success: true });
  } catch (err) {
    console.error('Error updating database:', err);
    appendConversionLog('error', `Library refresh failed: ${err.message}`);
    res.status(500).json({ success: false, message: 'Error updating database.' });
  }
});

// Route to upload and process EPUB files
app.post('/upload', requireAdmin, async (req, res) => {
  if (!req.files || !req.files.epubFiles) {
    res.status(400).json({ success: false, message: 'No EPUB files were uploaded.' });
    return;
  }

  const epubFiles = Array.isArray(req.files.epubFiles) ? req.files.epubFiles : [req.files.epubFiles];
  const stagedJobs = [];
  const queuedFiles = [];
  const typographyProfile = captureTypographyConversionSnapshot();

  try {
    for (const epubFile of epubFiles) {
      await validateUploadedEpub(epubFile);
    }

    for (const epubFile of epubFiles) {
      const outputFilename = await allocateOutputFilename(epubFile.name);
      const uploadPath = path.join(uploadsDir, `${uuidv4()}.epub`);
      watcherIgnoredPaths.add(uploadPath);
      setTimeout(() => watcherIgnoredPaths.delete(uploadPath), 30000);

      await epubFile.mv(uploadPath);
      stagedJobs.push({
        id: uuidv4(),
        uploadPath,
        outputFilename,
        typographyProfile
      });

      if (epubFile.tempFilePath && epubFile.tempFilePath !== uploadPath) {
        await fs.remove(epubFile.tempFilePath);
      }
    }

    for (const job of stagedJobs) {
      enqueueFile(job);
      queuedFiles.push(job.outputFilename);
    }
  } catch (err) {
    console.error('Error handling uploaded EPUB file:', err);
    appendConversionLog('error', `Upload rejected: ${err.message || 'Invalid EPUB file.'}`);

    for (const epubFile of epubFiles) {
      if (epubFile.tempFilePath) {
        await fs.remove(epubFile.tempFilePath);
      }
    }

    for (const job of stagedJobs) {
      watcherIgnoredPaths.delete(job.uploadPath);
      await fs.remove(job.uploadPath);
    }

    res.status(400).json({ success: false, message: err.message || 'Invalid EPUB file.' });
    return;
  }

  res.json({
    success: true,
    message: 'EPUB files uploaded successfully.',
    queuedFiles
  });
  appendConversionLog('info', `Accepted ${queuedFiles.length} upload${queuedFiles.length === 1 ? '' : 's'} into the conversion queue.`);
});

app.use((error, req, res, next) => {
  if (!error) {
    next();
    return;
  }

  if (res.headersSent) {
    next(error);
    return;
  }

  if (error.status === 413 || error.statusCode === 413) {
    const uploadLimitMb = Math.max(1, Math.round(MAX_UPLOAD_BYTES / (1024 * 1024)));
    const message = String(req.path || '') === '/upload'
      ? `Upload request too large. Dyslibria now retries large selections in smaller batches automatically, but a single EPUB may still exceed the server limit. Keep each EPUB under about ${uploadLimitMb} MB or increase the proxy/body-size limit.`
      : 'Request body too large.';

    if (String(req.path || '').startsWith('/api/') || String(req.path || '') === '/upload' || req.accepts('json')) {
      res.status(413).json({ success: false, message });
      return;
    }

    res.status(413).type('text/plain').send(message);
    return;
  }

  next(error);
});

// Route to get settings
app.get('/settings', requireAdmin, (req, res) => {
  try {
    res.json({
      webdavPort: String(webdavPort),
      opdsPort: String(PORT),
      uploadPath: uploadsDir,
      libraryPath: processedDir,
      baseUrl: configuredBaseUrl,
      themeColor: getThemeColorSetting(),
      themeColors: THEME_COLOR_OPTIONS
    });
  } catch (err) {
    console.error('Error fetching settings:', err);
    res.status(500).json({ success: false, message: 'Error fetching settings.' });
  }
});

// Route to update settings
app.post('/settings', requireAdmin, (req, res) => {
  try {
    const updates = normalizeSettingsUpdate(req.body);
    const restartSensitiveKeys = ['webdavPort', 'opdsPort', 'uploadPath', 'libraryPath', 'baseUrl'];
    const requiresRestart = Object.keys(updates).some((key) => restartSensitiveKeys.includes(key));

    persistSettingsPatch(updates);
    res.json({ success: true, requiresRestart });
  } catch (err) {
    console.error('Error updating settings:', err);
    res.status(400).json({ success: false, message: err.message || 'Error updating settings.' });
  }
});

app.get('/api/typography-profiles', requireAdmin, (req, res) => {
  try {
    res.json({
      success: true,
      ...buildTypographySettingsPayload()
    });
  } catch (error) {
    console.error('Error fetching typography profiles:', error);
    res.status(500).json({
      success: false,
      message: 'Unable to load Dyslibria typography profiles.'
    });
  }
});

app.post('/api/typography-profiles/selection', requireAdmin, (req, res) => {
  try {
    const customProfiles = readStoredCustomTypographyProfiles();
    const selectionType = String(req.body.type || '').trim().toLowerCase();
    const selectionId = selectionType === 'preset'
      ? (resolvePresetId(req.body.id) || '')
      : String(req.body.id || '').trim();

    const nextSelection = resolveTypographySelection({
      type: selectionType,
      id: selectionId
    }, customProfiles, {
      strict: true
    });

    persistSettingsPatch({
      [TYPOGRAPHY_SELECTION_KEY]: {
        type: nextSelection.type,
        id: nextSelection.id
      }
    });

    res.json({
      success: true,
      activeSelection: {
        type: nextSelection.type,
        id: nextSelection.id,
        label: nextSelection.label,
        description: nextSelection.description
      }
    });
  } catch (error) {
    console.error('Error selecting typography profile:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Unable to select the Dyslibria typography profile.'
    });
  }
});

app.post('/api/typography-profiles/custom', requireAdmin, (req, res) => {
  try {
    const customProfiles = readStoredCustomTypographyProfiles();
    const importedProfile = importCustomTypographyProfile({
      label: req.body.label,
      filename: req.body.filename,
      profileJson: req.body.profileJson
    });

    customProfiles.push(importedProfile);
    persistSettingsPatch({
      [CUSTOM_TYPOGRAPHY_PROFILES_KEY]: customProfiles
    });

    res.status(201).json({
      success: true,
      profile: importedProfile
    });
  } catch (error) {
    console.error('Error importing custom typography profile:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Unable to import the custom typography profile.'
    });
  }
});

app.delete('/api/typography-profiles/custom/:id', requireAdmin, (req, res) => {
  try {
    const customProfiles = readStoredCustomTypographyProfiles();
    const profileId = String(req.params.id || '').trim();
    const nextProfiles = customProfiles.filter((profile) => profile.id !== profileId);

    if (nextProfiles.length === customProfiles.length) {
      res.status(404).json({
        success: false,
        message: 'The custom typography profile could not be found.'
      });
      return;
    }

    const nextSelection = resolveTypographySelection(
      settingsDb.has(TYPOGRAPHY_SELECTION_KEY)
        ? settingsDb.get(TYPOGRAPHY_SELECTION_KEY)
        : { type: 'preset', id: DEFAULT_PRESET_ID },
      nextProfiles
    );

    persistSettingsPatch({
      [CUSTOM_TYPOGRAPHY_PROFILES_KEY]: nextProfiles,
      [TYPOGRAPHY_SELECTION_KEY]: {
        type: nextSelection.type,
        id: nextSelection.id
      }
    });

    res.json({
      success: true,
      activeSelection: {
        type: nextSelection.type,
        id: nextSelection.id,
        label: nextSelection.label
      }
    });
  } catch (error) {
    console.error('Error deleting custom typography profile:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Unable to delete the custom typography profile.'
    });
  }
});

// Route to restart the server
app.post('/restart-server', requireAdmin, (req, res) => {
  if (!allowServerRestart) {
    res.status(501).json({
      success: false,
      message: 'Server restart is disabled. Restart the process manually.'
    });
    return;
  }

  res.json({ success: true, message: 'Server is restarting...' });
  setTimeout(() => {
    execFile('pm2', ['restart', 'dyslibria'], (error, stdout, stderr) => {
      if (error) {
        console.error(`PM2 restart error: ${error.message}`);
        return;
      }

      if (stdout) {
        console.log(`pm2 stdout: ${stdout}`);
      }

      if (stderr) {
        console.error(`pm2 stderr: ${stderr}`);
      }
    });
  }, 1000);
});

// Schedule the database update every 4 hours
cron.schedule('0 */4 * * *', async () => {
  refreshLibraryMetadataInBackground();
});

// OPDS route
app.get('/opds', requireCatalogAuth, async (req, res) => {
  try {
    const epubs = await getEpubs({ cachePath: metadataCachePath });
    const feed = createOpdsFeed(epubs, getBaseUrl(req));
    res.type('application/atom+xml').send(feed);
  } catch (err) {
    console.error('Error generating OPDS feed:', err);
    res.status(500).send('Failed to generate OPDS feed');
  }
});

async function startApplication() {
  await ensureDirectoriesExist();
  app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });

  const webdavServer = new webdav.WebDAVServer({
    httpAuthentication: new webdav.HTTPBasicAuthentication((user, pass, callback) => {
      const authenticated = userStore.authenticate(user, pass);
      callback(Boolean(authenticated && authenticated.type === 'user'));
    }),
    privilegeManager: new webdav.SimplePathPrivilegeManager()
  });

  webdavServer.setFileSystem('/processed', new webdav.PhysicalFileSystem(processedDir), (success) => {
    if (success) {
      console.log('WebDAV server is serving the processed folder.');
    } else {
      console.error('Failed to set up the WebDAV file system.');
    }
  });

  webdavServer.start(webdavPort);
  console.log(`WebDAV server is running on http://localhost:${webdavPort}`);

  startUploadsWatcher();

  void queueExistingUploads().catch((error) => {
    console.error('Error scanning uploads on startup:', error);
    appendConversionLog('error', `Startup upload scan failed: ${error.message}`);
  });

  const metadataReady = await getMetadataReady();
  appendConversionLog(
    'info',
    metadataReady
      ? 'Using cached library metadata on startup. A background reconcile will check for external file changes.'
      : 'Library metadata cache missing. Building it in the background now.'
  );
  refreshLibraryMetadataInBackground({
    force: !metadataReady
  });
}

startApplication().catch((error) => {
  console.error('Fatal startup error:', error);
  process.exit(1);
});
