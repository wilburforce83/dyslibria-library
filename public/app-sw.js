const STATIC_CACHE = 'dyslibria-assets-v16';
const STATIC_ASSETS = [
  '/manifest.json',
  '/app-theme.js',
  '/offline.html',
  '/favicon.ico',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/icons/icon-maskable-192x192.png',
  '/icons/icon-maskable-512x512.png',
  '/icons/apple-touch-icon.png'
];
const APP_SHELL_DOCUMENTS = [
  '/authenticated/index.html',
  '/authenticated/reader.html'
];

function isCacheableRequest(request, url) {
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return false;
  }

  if (url.pathname === '/' || url.pathname === '/login' || url.pathname === '/sw.js') {
    return false;
  }

  if (url.pathname.startsWith('/authenticated/')) {
    return false;
  }

  if (STATIC_ASSETS.includes(url.pathname)) {
    return true;
  }

  return ['style', 'script', 'image', 'font'].includes(request.destination);
}

function isValidNavigationResponse(response) {
  if (!response || !response.ok) {
    return false;
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  return contentType.includes('text/html');
}

function isValidCachedResponse(request, response) {
  if (!response || !response.ok) {
    return false;
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('text/html')) {
    return false;
  }

  if (request.destination === 'style') {
    return contentType.includes('text/css');
  }

  if (request.destination === 'script') {
    return contentType.includes('javascript') || contentType.includes('ecmascript');
  }

  return true;
}

function shouldCacheNetworkResponse(request, response) {
  if (!isValidCachedResponse(request, response)) {
    return false;
  }

  if (response.redirected) {
    return false;
  }

  try {
    const responseUrl = new URL(response.url);
    const requestUrl = new URL(request.url);
    if (responseUrl.origin !== requestUrl.origin || responseUrl.pathname !== requestUrl.pathname) {
      return false;
    }
  } catch (error) {
    return false;
  }

  return true;
}

self.addEventListener('install', function (event) {
  event.waitUntil((async function () {
    const cache = await caches.open(STATIC_CACHE);
    await cache.addAll(STATIC_ASSETS);

    await Promise.all(APP_SHELL_DOCUMENTS.map(async function (documentPath) {
      try {
        const response = await fetch(documentPath, {
          credentials: 'same-origin'
        });

        if (isValidNavigationResponse(response) && !response.redirected) {
          await cache.put(documentPath, response.clone());
        }
      } catch (error) {
        return null;
      }

      return null;
    }));

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    const cacheNames = await caches.keys();

    await Promise.all(
      cacheNames
        .filter(function (cacheName) {
          return cacheName.startsWith('dyslibria-assets-') && cacheName !== STATIC_CACHE;
        })
        .map(function (cacheName) {
          return caches.delete(cacheName);
        })
    );

    await self.clients.claim();
  })());
});

self.addEventListener('fetch', function (event) {
  const url = new URL(event.request.url);

  if (event.request.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith((async function () {
      const cache = await caches.open(STATIC_CACHE);

      try {
        const response = await fetch(event.request);

        if (isValidNavigationResponse(response) && !response.redirected) {
          await cache.put(event.request, response.clone());
        }

        return response;
      } catch (error) {
        const cachedResponse = await cache.match(event.request, { ignoreSearch: true });
        if (cachedResponse && isValidNavigationResponse(cachedResponse)) {
          return cachedResponse;
        }

        const shellPath = url.pathname.startsWith('/authenticated/reader')
          ? '/authenticated/reader.html'
          : '/authenticated/index.html';
        const cachedShell = await cache.match(shellPath, { ignoreSearch: true });
        if (cachedShell && isValidNavigationResponse(cachedShell)) {
          return cachedShell;
        }

        const offlineResponse = await cache.match('/offline.html');
        if (offlineResponse) {
          return offlineResponse;
        }

        throw error;
      }
    })());
    return;
  }

  if (!isCacheableRequest(event.request, url)) {
    return;
  }

  event.respondWith((async function () {
    const cache = await caches.open(STATIC_CACHE);
    const cachedResponse = await cache.match(event.request, { ignoreSearch: true });

    if (cachedResponse && !isValidCachedResponse(event.request, cachedResponse)) {
      await cache.delete(event.request, { ignoreSearch: true });
    }

    try {
      const response = await fetch(event.request);
      if (shouldCacheNetworkResponse(event.request, response)) {
        cache.put(event.request, response.clone());
      }

      return response;
    } catch (error) {
      if (cachedResponse && isValidCachedResponse(event.request, cachedResponse)) {
        return cachedResponse;
      }

      throw error;
    }
  })());
});
