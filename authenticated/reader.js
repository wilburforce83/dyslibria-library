(function () {
  const params = new URLSearchParams(window.location.search);
  const fileName = params.get('file');
  const requestedLocation = params.get('loc');

  const SETTINGS_STORAGE_KEY = 'dyslibria:reader-settings:v1';
  const LOCATION_STORAGE_KEY = fileName ? `dyslibria:reader:${fileName}` : '';
  const AUTO_SPREAD_MIN_WIDTH = 1180;
  const previewFunctionWords = new Set([
    'a', 'an', 'and', 'as', 'at', 'but', 'by', 'can', 'for', 'from', 'help', 'in', 'keep',
    'less', 'make', 'more', 'of', 'on', 'or', 'the', 'to', 'with', 'without'
  ]);

  const defaultSettings = {
    theme: 'paper',
    fontFamily: 'accessible',
    fontSize: 110,
    lineHeight: 1.6,
    pageMargin: 6.5,
    layout: 'auto',
    flow: 'paginated',
    disableDyslibria: false
  };

  const numericSettingRanges = {
    fontSize: { min: 50, max: 235, step: 5, defaultValue: defaultSettings.fontSize },
    lineHeight: { min: 1.1, max: 2.5, step: 0.05, defaultValue: defaultSettings.lineHeight },
    pageMargin: { min: 3, max: 12, step: 0.5, defaultValue: defaultSettings.pageMargin }
  };

  const themeOptions = [
    { id: 'paper', name: 'Paper', mode: 'light' },
    { id: 'cream', name: 'Warm cream', mode: 'light' },
    { id: 'sepia', name: 'Soft sepia', mode: 'light' },
    { id: 'dusk', name: 'Dusk paper', mode: 'light' },
    { id: 'sage', name: 'Sage paper', mode: 'light' },
    { id: 'slate', name: 'Slate paper', mode: 'light' },
    { id: 'cotton', name: 'Cotton texture', mode: 'light' },
    { id: 'parchment', name: 'Parchment grain', mode: 'light' },
    { id: 'midnight', name: 'Midnight', mode: 'dark' }
  ];
  const themeIds = themeOptions.map(function (option) {
    return `theme-${option.id}`;
  });
  const themeModes = Object.fromEntries(themeOptions.map(function (option) {
    return [option.id, option.mode];
  }));

  let appPalette = window.DyslibriaTheme
    ? window.DyslibriaTheme.applyPalette(window.DyslibriaTheme.DEFAULT_COLOR_KEY, document.documentElement)
    : null;

  const fontOptions = [
    {
      id: 'accessible',
      name: 'Accessible Sans',
      family: '"Avenir Next", "Segoe UI", "Trebuchet MS", sans-serif',
      note: 'Familiar humanist system stack with steady shapes.',
      preview: 'Calmer scanning with friendly familiar letterforms.'
    },
    {
      id: 'atkinson',
      name: 'Atkinson Hyperlegible',
      family: '"Atkinson Hyperlegible", "Avenir Next", "Segoe UI", sans-serif',
      note: 'Built for stronger character distinction and readability.',
      preview: 'Clearer letters help keep fast lines from blurring.'
    },
    {
      id: 'lexend',
      name: 'Lexend',
      family: '"Lexend", "Avenir Next", "Segoe UI", sans-serif',
      note: 'Open spacing and smoother pacing for visual tracking.',
      preview: 'Roomier word shapes can slow visual crowding down.'
    },
    {
      id: 'sourceSans',
      name: 'Source Sans 3',
      family: '"Source Sans 3", "Segoe UI", sans-serif',
      note: 'Balanced, low-noise sans for longer reading sessions.',
      preview: 'A calmer page texture keeps focus on the sentence.'
    },
    {
      id: 'publicSans',
      name: 'Public Sans',
      family: '"Public Sans", "Segoe UI", sans-serif',
      note: 'Crisp proportions with a confident, sturdy rhythm.',
      preview: 'Clean rhythm can make paragraphs feel less hectic.'
    },
    {
      id: 'notoSans',
      name: 'Noto Sans',
      family: '"Noto Sans", "Segoe UI", sans-serif',
      note: 'Consistent spacing with broad language coverage.',
      preview: 'Steady spacing supports quieter, more even reading.'
    },
    {
      id: 'ibmPlex',
      name: 'IBM Plex Sans',
      family: '"IBM Plex Sans", "Segoe UI", sans-serif',
      note: 'Compact clarity for readers who like sharper structure.',
      preview: 'Sharper contours can anchor attention on each line.'
    },
    {
      id: 'nunito',
      name: 'Nunito Sans',
      family: '"Nunito Sans", "Segoe UI", sans-serif',
      note: 'Rounded shapes for a softer, less rigid page feel.',
      preview: 'Softer curves can make dense pages feel more gentle.'
    },
    {
      id: 'merriweatherSans',
      name: 'Merriweather Sans',
      family: '"Merriweather Sans", "Trebuchet MS", sans-serif',
      note: 'Open counters with a slightly more literary texture.',
      preview: 'Readable warmth without losing structure or contrast.'
    },
    {
      id: 'literata',
      name: 'Literata',
      family: '"Literata", "Iowan Old Style", "Palatino Linotype", Georgia, serif',
      note: 'Thoughtful serif rhythm for readers who like a bookish page.',
      preview: 'Gentle serif texture can make long reading feel grounded.'
    },
    {
      id: 'sourceSerif',
      name: 'Source Serif 4',
      family: '"Source Serif 4", "Palatino Linotype", Georgia, serif',
      note: 'Clear contemporary serif with strong structure and calm flow.',
      preview: 'Sharper serifs can help word shapes feel more anchored.'
    },
    {
      id: 'figtree',
      name: 'Figtree',
      family: '"Figtree", "Avenir Next", "Segoe UI", sans-serif',
      note: 'Friendly modern shapes with clean, even word flow.',
      preview: 'Smooth curves and tidy spacing can reduce fatigue.'
    }
  ];

  const fontFamilies = Object.fromEntries(fontOptions.map(function (option) {
    return [option.id, option.family];
  }));

  const legacyFontAliases = {
    serif: 'literata',
    classic: 'ibmPlex'
  };

  const zoneConfig = {
    previousMaxX: 0.22,
    nextMinX: 0.78,
    settingsMinX: 0.24,
    settingsMaxX: 0.76,
    settingsMinY: 0.24,
    settingsMaxY: 0.62,
    progressMinX: 0.18,
    progressMaxX: 0.82,
    progressMinY: 0.66
  };

  const elements = {
    app: document.getElementById('readerApp'),
    viewerFrame: document.querySelector('.viewer-frame'),
    loadingTitle: document.getElementById('loadingTitle'),
    loadingMeta: document.getElementById('loadingMeta'),
    loadingProgressLabel: document.getElementById('loadingProgressLabel'),
    loadingProgressDetail: document.getElementById('loadingProgressDetail'),
    loadingProgressFill: document.getElementById('loadingProgressFill'),
    progressActions: document.getElementById('progressActions'),
    progressPanel: document.getElementById('progressPanel'),
    progressTitle: document.getElementById('progressTitle'),
    progressMeta: document.getElementById('progressMeta'),
    progressDetail: document.getElementById('progressDetail'),
    closeProgress: document.getElementById('closeProgress'),
    settingsPanel: document.getElementById('settingsPanel'),
    closeSettings: document.getElementById('closeSettings'),
    scrim: document.getElementById('readerScrim'),
    viewer: document.getElementById('viewer'),
    progressLabel: document.getElementById('progressLabel'),
    chapterLabel: document.getElementById('chapterLabel'),
    progressFill: document.getElementById('progressFill'),
    themeSelect: document.getElementById('themeSelect'),
    fontPresetGrid: document.getElementById('fontPresetGrid'),
    fontSizeInput: document.getElementById('fontSizeInput'),
    fontSizeValue: document.getElementById('fontSizeValue'),
    lineHeightInput: document.getElementById('lineHeightInput'),
    lineHeightValue: document.getElementById('lineHeightValue'),
    pageMarginInput: document.getElementById('pageMarginInput'),
    pageMarginValue: document.getElementById('pageMarginValue'),
    layoutSelect: document.getElementById('layoutSelect'),
    disableDyslibriaInput: document.getElementById('disableDyslibriaInput')
  };

  const uiState = {
    overlay: null,
    overlayHistoryActive: false,
    lastSurfaceActionAt: 0,
    lastTouchEventAt: 0
  };

  let book = null;
  let rendition = null;
  let readingDirection = 'ltr';
  let flatTocEntries = [];
  let progressSaveTimer = null;
  let layoutRealignTimer = null;
  let latestProgress = {
    location: '',
    progressPercent: 0,
    chapterLabel: 'Loading chapter data…',
    pageLabel: '',
    pageNumber: null,
    totalPages: null,
    href: '',
    title: '',
    author: ''
  };

  function parseStoredJson(key, fallbackValue) {
    if (!key) {
      return fallbackValue;
    }

    try {
      const value = localStorage.getItem(key);
      return value ? { ...fallbackValue, ...JSON.parse(value) } : fallbackValue;
    } catch (error) {
      return fallbackValue;
    }
  }

  function normalizeFontFamilyKey(value) {
    const normalizedValue = String(value || '').trim();
    const nextValue = legacyFontAliases[normalizedValue] || normalizedValue;
    return fontFamilies[nextValue] ? nextValue : defaultSettings.fontFamily;
  }

  function normalizeThemeKey(value) {
    const normalizedValue = String(value || '').trim();
    return Object.prototype.hasOwnProperty.call(themeModes, normalizedValue)
      ? normalizedValue
      : defaultSettings.theme;
  }

  function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function normalizeNumericSetting(value, config) {
    const numericValue = Number(value);
    const safeValue = Number.isFinite(numericValue) ? numericValue : config.defaultValue;
    const clampedValue = clampNumber(safeValue, config.min, config.max);

    if (!config.step || config.step <= 0) {
      return clampedValue;
    }

    const roundedSteps = Math.round((clampedValue - config.min) / config.step);
    const normalizedValue = config.min + roundedSteps * config.step;
    const stepPrecision = String(config.step).split('.')[1];
    const precision = stepPrecision ? stepPrecision.length : 0;

    return Number(normalizedValue.toFixed(precision));
  }

  function formatSliderNumber(value, maxDecimals = 2) {
    return Number(value).toFixed(maxDecimals).replace(/\.?0+$/, '');
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getPreviewAnchorWordIndexes(words) {
    const targetCount = Math.max(1, Math.min(3, Math.round(words.length / 4)));
    const candidates = words
      .map(function (word, index) {
        const normalizedWord = word.toLowerCase();
        const isFunctionWord = previewFunctionWords.has(normalizedWord);
        return {
          index,
          word,
          score: word.length + (isFunctionWord ? 0 : 1.5) - index * 0.08
        };
      })
      .filter(function (entry) {
        return entry.word.length >= 4;
      })
      .sort(function (left, right) {
        return right.score - left.score;
      });
    const selectedIndexes = [];

    candidates.forEach(function (candidate) {
      if (selectedIndexes.length >= targetCount) {
        return;
      }

      const hasNearbyAnchor = selectedIndexes.some(function (selectedIndex) {
        return Math.abs(selectedIndex - candidate.index) < 2;
      });

      if (!hasNearbyAnchor) {
        selectedIndexes.push(candidate.index);
      }
    });

    if (!selectedIndexes.length && words.length) {
      selectedIndexes.push(0);
    }

    return new Set(selectedIndexes);
  }

  function createDyslibriaPreviewMarkup(text) {
    const wordPattern = /([A-Za-z][A-Za-z'-]*)/g;
    const matches = [];
    let match = null;

    while ((match = wordPattern.exec(text)) !== null) {
      matches.push({
        index: matches.length,
        start: match.index,
        word: match[0]
      });
    }

    const anchorIndexes = getPreviewAnchorWordIndexes(matches.map(function (entry) {
      return entry.word;
    }));
    let output = '';
    let lastIndex = 0;

    matches.forEach(function (entry) {
      output += escapeHtml(text.slice(lastIndex, entry.start));
      output += anchorIndexes.has(entry.index)
        ? `<strong class="font-choice-anchor">${escapeHtml(entry.word)}</strong>`
        : escapeHtml(entry.word);
      lastIndex = entry.start + entry.word.length;
    });

    output += escapeHtml(text.slice(lastIndex));
    return output;
  }

  function updateFontChoiceSelection() {
    if (!elements.fontPresetGrid) {
      return;
    }

    elements.fontPresetGrid.querySelectorAll('.font-choice').forEach(function (button) {
      const isActive = button.dataset.fontId === settings.fontFamily;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  function renderFontChoices() {
    if (!elements.fontPresetGrid) {
      return;
    }

    elements.fontPresetGrid.innerHTML = '';

    fontOptions.forEach(function (option) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'font-choice';
      button.dataset.fontId = option.id;
      button.style.fontFamily = option.family;
      button.setAttribute('aria-label', option.name);
      button.innerHTML = `
        <span class="font-choice-name">${escapeHtml(option.name)}</span>
        <span class="font-choice-preview">${createDyslibriaPreviewMarkup(option.preview)}</span>
        <span class="font-choice-note">${escapeHtml(option.note)}</span>
      `;
      button.addEventListener('click', function () {
        settings.fontFamily = option.id;
        updateFontChoiceSelection();
        applyReaderSettings();
        persistSettings();
      });
      elements.fontPresetGrid.appendChild(button);
    });

    updateFontChoiceSelection();
  }

  function renderThemeChoices() {
    if (!elements.themeSelect) {
      return;
    }

    elements.themeSelect.innerHTML = '';
    themeOptions.forEach(function (option) {
      const selectOption = document.createElement('option');
      selectOption.value = option.id;
      selectOption.textContent = option.name;
      elements.themeSelect.appendChild(selectOption);
    });
  }

  const settings = parseStoredJson(SETTINGS_STORAGE_KEY, defaultSettings);
  settings.theme = normalizeThemeKey(settings.theme);
  settings.fontFamily = normalizeFontFamilyKey(settings.fontFamily);
  settings.fontSize = normalizeNumericSetting(settings.fontSize, numericSettingRanges.fontSize);
  settings.lineHeight = normalizeNumericSetting(settings.lineHeight, numericSettingRanges.lineHeight);
  settings.pageMargin = normalizeNumericSetting(settings.pageMargin, numericSettingRanges.pageMargin);
  settings.flow = 'paginated';
  settings.disableDyslibria = Boolean(settings.disableDyslibria);

  function persistSettings() {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }

  function persistLocalLocation(cfi) {
    if (!LOCATION_STORAGE_KEY || !cfi) {
      return;
    }

    localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify({ location: cfi }));
  }

  function getSavedLocalLocation() {
    if (!LOCATION_STORAGE_KEY) {
      return '';
    }

    try {
      const stored = JSON.parse(localStorage.getItem(LOCATION_STORAGE_KEY) || '{}');
      return stored.location || '';
    } catch (error) {
      return '';
    }
  }

  async function fetchSavedProgress(filename) {
    const fallbackLocation = getSavedLocalLocation();

    try {
      const response = await fetch(`/api/reading-progress/${encodeURIComponent(filename)}`, {
        credentials: 'same-origin'
      });

      if (!response.ok) {
        throw new Error(`Progress lookup failed (${response.status})`);
      }

      const payload = await response.json();
      if (payload && payload.progress && payload.progress.location) {
        persistLocalLocation(payload.progress.location);
        return payload.progress;
      }
    } catch (error) {
      console.warn('Unable to load saved reading progress from the server:', error);
    }

    return fallbackLocation ? { location: fallbackLocation } : null;
  }

  async function saveReadingProgress(snapshot) {
    if (!fileName || !snapshot || !snapshot.location) {
      return;
    }

    try {
      const response = await fetch(`/api/reading-progress/${encodeURIComponent(fileName)}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(snapshot)
      });

      if (!response.ok) {
        throw new Error(`Progress save failed (${response.status})`);
      }
    } catch (error) {
      console.warn('Unable to persist reading progress to the server:', error);
    }
  }

  function scheduleReadingProgressSave(snapshot) {
    if (progressSaveTimer) {
      clearTimeout(progressSaveTimer);
    }

    const payload = {
      location: snapshot.location,
      progressPercent: snapshot.progressPercent,
      chapterLabel: snapshot.chapterLabel,
      pageLabel: snapshot.pageLabel,
      pageNumber: snapshot.pageNumber,
      totalPages: snapshot.totalPages,
      href: snapshot.href,
      title: snapshot.title,
      author: snapshot.author
    };

    progressSaveTimer = setTimeout(function () {
      void saveReadingProgress(payload);
    }, 180);
  }

  function updateSettingLabels() {
    elements.fontSizeInput.min = String(numericSettingRanges.fontSize.min);
    elements.fontSizeInput.max = String(numericSettingRanges.fontSize.max);
    elements.fontSizeInput.step = String(numericSettingRanges.fontSize.step);
    elements.lineHeightInput.min = String(numericSettingRanges.lineHeight.min);
    elements.lineHeightInput.max = String(numericSettingRanges.lineHeight.max);
    elements.lineHeightInput.step = String(numericSettingRanges.lineHeight.step);
    elements.pageMarginInput.min = String(numericSettingRanges.pageMargin.min);
    elements.pageMarginInput.max = String(numericSettingRanges.pageMargin.max);
    elements.pageMarginInput.step = String(numericSettingRanges.pageMargin.step);
    elements.themeSelect.value = settings.theme;
    elements.fontSizeInput.value = settings.fontSize;
    elements.lineHeightInput.value = settings.lineHeight;
    elements.pageMarginInput.value = settings.pageMargin;
    elements.layoutSelect.value = settings.layout;
    elements.disableDyslibriaInput.checked = settings.disableDyslibria;
    elements.fontSizeValue.textContent = `${settings.fontSize}%`;
    elements.lineHeightValue.textContent = formatSliderNumber(settings.lineHeight);
    elements.pageMarginValue.textContent = `${formatSliderNumber(settings.pageMargin, 1)}%`;
    updateFontChoiceSelection();
  }

  async function loadAppConfig() {
    if (!window.DyslibriaTheme) {
      return;
    }

    try {
      const response = await fetch('/api/app-config', {
        credentials: 'same-origin'
      });

      if (!response.ok) {
        throw new Error(`Theme config lookup failed (${response.status})`);
      }

      const payload = await response.json();
      appPalette = window.DyslibriaTheme.applyPalette(
        payload.themeColor || window.DyslibriaTheme.DEFAULT_COLOR_KEY,
        document.documentElement
      );
    } catch (error) {
      appPalette = window.DyslibriaTheme.applyPalette(
        window.DyslibriaTheme.DEFAULT_COLOR_KEY,
        document.documentElement
      );
    }
  }

  function applyShellTheme() {
    themeIds.forEach(function (themeClassName) {
      elements.app.classList.remove(themeClassName);
    });
    elements.app.classList.add(`theme-${settings.theme}`);

    const metaTheme = document.querySelector('meta[name="theme-color"]');
    const themeMode = themeModes[settings.theme] === 'dark' ? 'dark' : 'light';
    if (metaTheme) {
      if (window.DyslibriaTheme && appPalette) {
        metaTheme.setAttribute(
          'content',
          window.DyslibriaTheme.getMetaThemeColor(themeMode, appPalette)
        );
      } else {
        metaTheme.setAttribute('content', themeMode === 'dark' ? '#0f1620' : '#18281f');
      }
    }
  }

  function updateOverlayState() {
    const settingsOpen = uiState.overlay === 'settings';
    const progressOpen = uiState.overlay === 'progress';
    const overlayVisible = Boolean(uiState.overlay);

    elements.settingsPanel.classList.toggle('is-open', settingsOpen);
    elements.settingsPanel.setAttribute('aria-hidden', settingsOpen ? 'false' : 'true');
    elements.progressPanel.classList.toggle('is-open', progressOpen);
    elements.progressPanel.setAttribute('aria-hidden', progressOpen ? 'false' : 'true');
    elements.scrim.classList.toggle('is-visible', overlayVisible);
    elements.progressActions.hidden = !progressOpen;
    elements.progressActions.classList.toggle('is-visible', progressOpen);
  }

  function openOverlay(name, options = {}) {
    if (uiState.overlay === name) {
      return;
    }

    if (options.pushHistory !== false && !uiState.overlayHistoryActive) {
      history.pushState({ dyslibriaOverlay: name }, '', window.location.href);
      uiState.overlayHistoryActive = true;
    }

    uiState.overlay = name;
    updateOverlayState();
  }

  function closeOverlay(options = {}) {
    if (!uiState.overlay) {
      return;
    }

    if (!options.fromHistory && uiState.overlayHistoryActive) {
      history.back();
      return;
    }

    if (options.fromHistory) {
      uiState.overlayHistoryActive = false;
    }

    uiState.overlay = null;
    updateOverlayState();
  }

  function setLoadingState(title, subtitle) {
    elements.loadingTitle.textContent = title;
    elements.loadingMeta.textContent = subtitle;
  }

  function setLoadingProgress(percent, detail) {
    const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
    const safeDetail = detail || 'Preparing reader shell';

    elements.loadingProgressLabel.textContent = `${safePercent}%`;
    elements.loadingProgressDetail.textContent = safeDetail;
    elements.loadingProgressFill.style.width = `${safePercent}%`;
  }

  function markLoaded() {
    elements.app.classList.add('is-loaded');
  }

  function normalizeHref(href) {
    return String(href || '').split('#')[0];
  }

  function getDisplaySpread() {
    return settings.layout === 'auto' ? 'auto' : settings.layout;
  }

  function getReaderPageMargins() {
    const pageMargin = normalizeNumericSetting(settings.pageMargin, numericSettingRanges.pageMargin);
    const verticalPageMargin = Math.max(2.5, Math.min(10, pageMargin - (window.innerWidth < 700 ? 0.2 : 0.8)));

    return {
      inline: pageMargin,
      block: verticalPageMargin
    };
  }

  function applyViewerMargins() {
    if (!elements.viewerFrame) {
      return;
    }

    const margins = getReaderPageMargins();
    elements.viewerFrame.style.setProperty('--reader-page-inline-margin', `${margins.inline}%`);
    elements.viewerFrame.style.setProperty('--reader-page-block-margin', `${margins.block}%`);
  }

  function resizeRendition() {
    if (!rendition || !rendition.manager || !rendition.manager.isRendered()) {
      return;
    }

    const width = Math.floor(elements.viewer.clientWidth);
    const height = Math.floor(elements.viewer.clientHeight);

    if (width > 0 && height > 0) {
      rendition.resize(width, height);
    }
  }

  function getStableLocationTarget() {
    if (rendition && typeof rendition.currentLocation === 'function') {
      const location = rendition.currentLocation();
      if (location && location.start && location.start.cfi) {
        return location.start.cfi;
      }
    }

    return latestProgress.location || requestedLocation || getSavedLocalLocation() || '';
  }

  function scheduleLayoutRealignment() {
    if (!rendition || !rendition.manager || !rendition.manager.isRendered()) {
      return;
    }

    if (layoutRealignTimer) {
      clearTimeout(layoutRealignTimer);
    }

    layoutRealignTimer = setTimeout(function () {
      layoutRealignTimer = null;

      if (!rendition) {
        return;
      }

      const targetLocation = getStableLocationTarget();
      if (!targetLocation) {
        return;
      }

      Promise.resolve(rendition.display(targetLocation)).catch(function (error) {
        console.warn('Unable to realign the paginated spread after a layout change:', error);
      });
    }, 48);
  }

  function isInteractiveTarget(target) {
    return Boolean(
      target &&
      typeof target.closest === 'function' &&
      target.closest('a, button, input, textarea, select, label, summary, audio, video')
    );
  }

  function getPointerClientPoint(event, contents) {
    if (typeof event.clientX === 'number' && typeof event.clientY === 'number') {
      return normalizePointerPoint({
        x: event.clientX,
        y: event.clientY
      }, contents);
    }

    const touch = (event.changedTouches && event.changedTouches[0]) ||
      (event.touches && event.touches[0]);

    if (!touch) {
      return null;
    }

    return normalizePointerPoint({
      x: touch.clientX,
      y: touch.clientY
    }, contents);
  }

  function normalizePointerPoint(point, contents) {
    const frameElement = contents &&
      contents.window &&
      contents.window.frameElement &&
      typeof contents.window.frameElement.getBoundingClientRect === 'function'
      ? contents.window.frameElement
      : null;

    if (!frameElement) {
      return point;
    }

    const frameRect = frameElement.getBoundingClientRect();
    return {
      x: frameRect.left + point.x,
      y: frameRect.top + point.y
    };
  }

  function goNext() {
    if (!rendition) {
      return;
    }

    if (readingDirection === 'rtl') {
      rendition.prev();
      return;
    }

    rendition.next();
  }

  function goPrevious() {
    if (!rendition) {
      return;
    }

    if (readingDirection === 'rtl') {
      rendition.next();
      return;
    }

    rendition.prev();
  }

  function shouldIgnoreSurfaceEvent(event) {
    const now = Date.now();
    if (event.type === 'click' && now - uiState.lastTouchEventAt < 700) {
      return true;
    }

    if (event.type === 'touchend') {
      uiState.lastTouchEventAt = now;
    }

    if (now - uiState.lastSurfaceActionAt < 250) {
      return true;
    }

    uiState.lastSurfaceActionAt = now;
    return false;
  }

  function handleViewportZoneAction(point, event) {
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;

    if (!point || viewportWidth <= 0 || viewportHeight <= 0) {
      return;
    }

    const xRatio = point.x / viewportWidth;
    const yRatio = point.y / viewportHeight;

    if (typeof event.preventDefault === 'function') {
      event.preventDefault();
    }

    if (
      xRatio >= zoneConfig.progressMinX &&
      xRatio <= zoneConfig.progressMaxX &&
      yRatio >= zoneConfig.progressMinY
    ) {
      openOverlay('progress');
      return;
    }

    if (
      xRatio >= zoneConfig.settingsMinX &&
      xRatio <= zoneConfig.settingsMaxX &&
      yRatio >= zoneConfig.settingsMinY &&
      yRatio <= zoneConfig.settingsMaxY
    ) {
      openOverlay('settings');
      return;
    }

    if (xRatio <= zoneConfig.previousMaxX) {
      goPrevious();
      return;
    }

    if (xRatio >= zoneConfig.nextMinX) {
      goNext();
    }
  }

  function handleSurfaceInteraction(event, contents) {
    if (!contents || !contents.window || uiState.overlay) {
      return;
    }

    if (isInteractiveTarget(event.target)) {
      return;
    }

    if (shouldIgnoreSurfaceEvent(event)) {
      return;
    }

    const point = getPointerClientPoint(event, contents);
    if (!point) {
      return;
    }

    handleViewportZoneAction(point, event);
  }

  function handleShellSurfaceInteraction(event) {
    if (uiState.overlay || !elements.viewerFrame || !elements.viewerFrame.contains(event.target)) {
      return;
    }

    if (
      event.target !== elements.viewerFrame &&
      event.target !== elements.viewer
    ) {
      return;
    }

    if (shouldIgnoreSurfaceEvent(event)) {
      return;
    }

    const point = getPointerClientPoint(event, null);
    if (!point) {
      return;
    }

    handleViewportZoneAction(point, event);
  }

  function lockContentSelection(contents) {
    if (!contents || !contents.document) {
      return;
    }

    const doc = contents.document;
    const root = doc.documentElement;

    if (root && root.dataset.dyslibriaSelectionLocked === 'true') {
      return;
    }

    if (root) {
      root.dataset.dyslibriaSelectionLocked = 'true';
    }

    const styleTag = doc.createElement('style');
    styleTag.textContent = `
      html,
      body,
      body * {
        -webkit-user-select: none !important;
        -moz-user-select: none !important;
        user-select: none !important;
        -webkit-touch-callout: none !important;
      }

      * {
        -webkit-tap-highlight-color: transparent !important;
      }
    `;

    if (doc.head) {
      doc.head.appendChild(styleTag);
    } else if (doc.documentElement) {
      doc.documentElement.appendChild(styleTag);
    }

    doc.addEventListener('selectstart', function (event) {
      event.preventDefault();
    });

    doc.addEventListener('selectionchange', function () {
      const selection = doc.getSelection && doc.getSelection();
      if (selection && !selection.isCollapsed) {
        selection.removeAllRanges();
      }
    });
  }

  function normalizeInlineText(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function isCoverLikeDocument(doc) {
    if (!doc || !doc.body) {
      return false;
    }

    const body = doc.body;
    const root = doc.documentElement;

    if (body.classList.contains('x-ebookmaker-coverpage')) {
      return true;
    }

    if (root && root.classList && root.classList.contains('x-ebookmaker-coverpage')) {
      return true;
    }

    if (body.querySelector('.x-ebookmaker-cover')) {
      return true;
    }

    const images = body.querySelectorAll('img, picture img');
    if (images.length !== 1) {
      return false;
    }

    if (body.querySelector('table, ul, ol, dl, pre, code, article, section, aside, main, nav')) {
      return false;
    }

    const readableBlocks = Array.from(
      body.querySelectorAll('p, h1, h2, h3, h4, h5, h6, figcaption, blockquote')
    ).filter(function (element) {
      return normalizeInlineText(element.textContent);
    });

    if (readableBlocks.length > 0) {
      return false;
    }

    const childTags = Array.from(body.children).map(function (element) {
      return element.tagName.toLowerCase();
    });
    const compactWrapper = childTags.every(function (tagName) {
      return ['div', 'figure', 'img', 'picture', 'a', 'br'].includes(tagName);
    });

    if (!compactWrapper) {
      return false;
    }

    const bodyText = normalizeInlineText(body.textContent);
    const anchorLabels = Array.from(body.querySelectorAll('a'))
      .map(function (anchor) {
        return normalizeInlineText(anchor.textContent);
      })
      .filter(Boolean);
    const onlyCoverNavigation =
      anchorLabels.length > 0 &&
      anchorLabels.every(function (label) {
        return ['back', 'cover', 'front cover', 'title page', 'continue'].includes(label);
      });
    const titleHint = /cover|jacket|linked image/.test(normalizeInlineText(doc.title));

    return (
      titleHint ||
      bodyText === '' ||
      bodyText === 'back' ||
      bodyText === 'cover' ||
      onlyCoverNavigation
    );
  }

  function updateCoverPresentationMode(doc) {
    if (!doc || !doc.body) {
      return;
    }

    const isCoverPage = isCoverLikeDocument(doc);
    const root = doc.documentElement;
    const coverNavigationLabels = ['back', 'cover', 'front cover', 'title page', 'continue'];

    Array.from(doc.querySelectorAll('a')).forEach(function (anchor) {
      const label = normalizeInlineText(anchor.textContent);
      const isCoverNavigationLink =
        !anchor.querySelector('img, picture, svg') &&
        coverNavigationLabels.includes(label);

      if (isCoverPage && isCoverNavigationLink) {
        anchor.setAttribute('data-dyslibria-cover-nav', 'true');
      } else {
        anchor.removeAttribute('data-dyslibria-cover-nav');
      }
    });

    if (root) {
      if (isCoverPage) {
        root.setAttribute('data-dyslibria-cover-page', 'true');
      } else {
        root.removeAttribute('data-dyslibria-cover-page');
      }
    }

    if (isCoverPage) {
      doc.body.setAttribute('data-dyslibria-cover-page', 'true');
    } else {
      doc.body.removeAttribute('data-dyslibria-cover-page');
    }
  }

  function buildContentPresentationStyles() {
    const readerStyleSource = elements.app || document.documentElement;
    const readerStyles = window.getComputedStyle(readerStyleSource);
    const fontFamily = fontFamilies[settings.fontFamily] || fontFamilies.accessible;
    const pageText = readerStyles.getPropertyValue('--reader-page-text').trim() || '#1b1a18';
    const readerAccent = readerStyles.getPropertyValue('--reader-accent').trim() || '#d05834';

    const dyslibriaOffRules = settings.disableDyslibria
      ? `
      b,
      strong,
      .dyslibria-tier-primary,
      .dyslibria-tier-secondary,
      .dyslibria-tier-tertiary,
      .dl-anchor-primary,
      .dl-anchor-secondary,
      .dl-anchor-tertiary,
      .dyslibria-frontload-prefix,
      .dl-prefix {
        font-weight: inherit !important;
        opacity: 1 !important;
      }

      .dyslibria-tier-spacing,
      .dl-spacing-only {
        letter-spacing: inherit !important;
      }

      .dyslibria-tier-marker,
      .dl-marker-only {
        box-shadow: none !important;
      }
    `
      : '';

    return `
      html,
      body {
        -webkit-text-size-adjust: 100% !important;
        text-size-adjust: 100% !important;
        background: transparent !important;
        background-color: transparent !important;
        background-image: none !important;
        color: ${pageText} !important;
      }

      body {
        font-family: ${fontFamily} !important;
        line-height: ${String(settings.lineHeight)} !important;
        text-rendering: optimizeLegibility;
      }

      img,
      svg,
      video,
      canvas,
      figure,
      picture {
        max-width: 100% !important;
        height: auto !important;
        background: transparent !important;
        background-color: transparent !important;
      }

      a,
      a:visited {
        color: ${readerAccent} !important;
      }

      .dyslibria-engine,
      .dl-engine,
      .dyslibria-paragraph,
      .dl-paragraph,
      .dyslibria-word,
      .dl-word,
      .dyslibria-zone,
      .dl-zone,
      .dyslibria-frontload-remainder,
      .dl-frontload-remainder,
      .dyslibria-frontload-prefix,
      .dl-prefix {
        color: inherit !important;
        line-height: ${String(settings.lineHeight)} !important;
        white-space: normal !important;
      }

      html[data-dyslibria-cover-page="true"],
      body[data-dyslibria-cover-page="true"] {
        background: transparent !important;
        background-color: transparent !important;
      }

      body[data-dyslibria-cover-page="true"] {
        margin: 0 !important;
        padding: 0 !important;
        width: 100% !important;
        max-width: none !important;
        min-height: 100% !important;
      }

      body[data-dyslibria-cover-page="true"].dyslibria-engine,
      body[data-dyslibria-cover-page="true"].dl-engine {
        max-width: none !important;
      }

      body[data-dyslibria-cover-page="true"] .x-ebookmaker-cover,
      body[data-dyslibria-cover-page="true"] .x-ebookmaker-wrapper,
      body[data-dyslibria-cover-page="true"] .dyslibria-paragraph,
      body[data-dyslibria-cover-page="true"] .dl-paragraph,
      body[data-dyslibria-cover-page="true"] figure,
      body[data-dyslibria-cover-page="true"] picture,
      body[data-dyslibria-cover-page="true"] div {
        background: transparent !important;
        background-color: transparent !important;
        border: 0 !important;
        box-shadow: none !important;
        margin: 0 !important;
        padding: 0 !important;
        max-width: none !important;
        width: auto !important;
        height: auto !important;
        text-indent: 0 !important;
      }

      body[data-dyslibria-cover-page="true"] img,
      body[data-dyslibria-cover-page="true"] picture img {
        display: block !important;
        margin: 0 auto !important;
        max-width: 100% !important;
        max-height: 100% !important;
        object-fit: contain !important;
      }

      body[data-dyslibria-cover-page="true"] a[data-dyslibria-cover-nav="true"],
      body[data-dyslibria-cover-page="true"] br {
        display: none !important;
      }

      ${dyslibriaOffRules}
    `;
  }

  function buildRenditionThemeRules() {
    const readerStyleSource = elements.app || document.documentElement;
    const readerStyles = window.getComputedStyle(readerStyleSource);
    const fontFamily = fontFamilies[settings.fontFamily] || fontFamilies.accessible;
    const pageText = readerStyles.getPropertyValue('--reader-page-text').trim() || '#1b1a18';

    return {
      html: {
        '-webkit-text-size-adjust': '100% !important',
        'text-size-adjust': '100% !important',
        'background': 'transparent !important',
        'background-color': 'transparent !important',
        'background-image': 'none !important',
        'color': `${pageText} !important`
      },
      body: {
        'font-family': `${fontFamily} !important`,
        'line-height': `${String(settings.lineHeight)} !important`,
        'text-rendering': 'optimizeLegibility',
        'background': 'transparent !important',
        'background-color': 'transparent !important',
        'background-image': 'none !important',
        'color': `${pageText} !important`
      },
      'img, svg, video, canvas': {
        'max-width': '100%',
        height: 'auto'
      },
      'figure, picture': {
        'max-width': '100%'
      }
    };
  }

  function applyContentPresentationOverrides(contents) {
    if (!contents || !contents.document) {
      return;
    }

    const doc = contents.document;
    updateCoverPresentationMode(doc);
    let styleTag = doc.getElementById('dyslibriaContentOverrides');

    if (!styleTag) {
      styleTag = doc.createElement('style');
      styleTag.id = 'dyslibriaContentOverrides';

      if (doc.head) {
        doc.head.appendChild(styleTag);
      } else if (doc.documentElement) {
        doc.documentElement.appendChild(styleTag);
      }
    }

    styleTag.textContent = buildContentPresentationStyles();
  }

  function updateOpenContentPresentationOverrides() {
    if (!rendition || typeof rendition.getContents !== 'function') {
      return;
    }

    rendition.getContents().forEach(function (contents) {
      applyContentPresentationOverrides(contents);
    });
  }

  async function fetchEpubBuffer(filename) {
    const response = await fetch(`/epub/${encodeURIComponent(filename)}`, {
      credentials: 'same-origin',
      headers: {
        Accept: 'application/epub+zip'
      }
    });

    if (!response.ok) {
      throw new Error(`Reader could not load this EPUB (${response.status}).`);
    }

    return response.arrayBuffer();
  }

  function applyReaderSettings() {
    if (!rendition) {
      return;
    }

    applyViewerMargins();

    // The reader should remain themeable and readable first, while Dyslibria
    // continues to control structure and emphasis inside the EPUB itself.
    rendition.themes.default(buildRenditionThemeRules());

    rendition.themes.fontSize(`${settings.fontSize}%`);
    rendition.flow('paginated');
    rendition.spread(getDisplaySpread());
    updateOpenContentPresentationOverrides();
    resizeRendition();
    scheduleLayoutRealignment();
  }

  function updateMetadata(title, author) {
    const safeTitle = title || fileName || 'Untitled book';
    const safeAuthor = author || 'Unknown author';

    elements.progressTitle.textContent = safeTitle;
    elements.progressMeta.textContent = safeAuthor;
    setLoadingState(safeTitle, safeAuthor);
    document.title = `${safeTitle} · Dyslibria`;

    latestProgress.title = safeTitle;
    latestProgress.author = safeAuthor;
  }

  function flattenTocEntries(items, output) {
    items.forEach(function (item) {
      output.push({
        href: normalizeHref(item.href),
        label: item.label || 'Untitled chapter'
      });

      const children = item.subitems || item.children || [];
      if (children.length > 0) {
        flattenTocEntries(children, output);
      }
    });
  }

  function formatPageLabel(pageNumber, totalPages) {
    if (!Number.isFinite(pageNumber) || !Number.isFinite(totalPages) || pageNumber <= 0 || totalPages <= 0) {
      return '';
    }

    return `Page ${pageNumber} of ${totalPages}`;
  }

  function updateProgress(location) {
    if (!location || !location.start) {
      return;
    }

    const activeHref = normalizeHref(location.start.href);
    const displayed = location.start.displayed || {};
    const activeEntry = flatTocEntries.find(function (entry) {
      return entry.href === activeHref || activeHref.startsWith(entry.href);
    });

    let percent = latestProgress.progressPercent || 0;
    let pageNumber = Number.isFinite(location.start.location) ? location.start.location + 1 : null;
    let totalPages = book && book.locations && Number.isFinite(book.locations.total)
      ? book.locations.total + 1
      : null;

    if (Number.isFinite(location.start.percentage)) {
      percent = Math.round(location.start.percentage * 100);
    }

    if (book && book.locations && location.start.cfi) {
      try {
        percent = Math.round(book.locations.percentageFromCfi(location.start.cfi) * 100);
      } catch (error) {
        percent = latestProgress.progressPercent || 0;
      }
    }

    if (!Number.isFinite(pageNumber) && displayed.page) {
      pageNumber = displayed.page;
    }

    if (!Number.isFinite(totalPages) && displayed.total) {
      totalPages = displayed.total;
    }

    const pageLabel = formatPageLabel(pageNumber, totalPages);
    const chapterParts = [];

    if (activeEntry && activeEntry.label) {
      chapterParts.push(activeEntry.label);
    }

    if (pageLabel) {
      chapterParts.push(pageLabel);
    }

    const chapterLabel = chapterParts.join(' · ') || 'Reading';

    latestProgress = {
      ...latestProgress,
      location: location.start.cfi || latestProgress.location,
      progressPercent: percent,
      chapterLabel,
      pageLabel,
      pageNumber: Number.isFinite(pageNumber) ? pageNumber : null,
      totalPages: Number.isFinite(totalPages) ? totalPages : null,
      href: activeHref
    };

    elements.progressLabel.textContent = `${percent}%`;
    elements.progressFill.style.width = `${percent}%`;
    elements.chapterLabel.textContent = chapterLabel;
    elements.progressDetail.textContent = pageLabel
      ? `${pageLabel}. Reading progress saves on the server automatically.`
      : 'Reading progress saves on the server automatically.';

    if (latestProgress.location) {
      persistLocalLocation(latestProgress.location);
      scheduleReadingProgressSave(latestProgress);
    }
  }

  function applySavedProgress(snapshot) {
    if (!snapshot) {
      return;
    }

    latestProgress = {
      ...latestProgress,
      ...snapshot
    };

    if (snapshot.title || snapshot.author) {
      updateMetadata(snapshot.title || latestProgress.title, snapshot.author || latestProgress.author);
    }

    if (typeof snapshot.progressPercent === 'number') {
      elements.progressLabel.textContent = `${snapshot.progressPercent}%`;
      elements.progressFill.style.width = `${snapshot.progressPercent}%`;
    }

    if (snapshot.chapterLabel) {
      elements.chapterLabel.textContent = snapshot.chapterLabel;
    }

    if (snapshot.pageLabel) {
      elements.progressDetail.textContent = `${snapshot.pageLabel}. Reading progress saves on the server automatically.`;
    } else {
      const fallbackPageLabel = formatPageLabel(snapshot.pageNumber, snapshot.totalPages);
      if (fallbackPageLabel) {
        elements.progressDetail.textContent = `${fallbackPageLabel}. Reading progress saves on the server automatically.`;
      }
    }
  }

  function attachEventListeners() {
    elements.closeSettings.addEventListener('click', function () {
      closeOverlay();
    });

    elements.closeProgress.addEventListener('click', function () {
      closeOverlay();
    });

    elements.scrim.addEventListener('click', function () {
      closeOverlay();
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && uiState.overlay) {
        closeOverlay();
        return;
      }

      if (uiState.overlay) {
        return;
      }

      if (event.key === 'ArrowLeft') {
        goPrevious();
      }

      if (event.key === 'ArrowRight') {
        goNext();
      }
    });

    elements.themeSelect.addEventListener('change', function () {
      settings.theme = this.value;
      applyShellTheme();
      applyReaderSettings();
      persistSettings();
    });

    elements.fontSizeInput.addEventListener('input', function () {
      settings.fontSize = normalizeNumericSetting(this.value, numericSettingRanges.fontSize);
      updateSettingLabels();
      applyReaderSettings();
      persistSettings();
    });

    elements.lineHeightInput.addEventListener('input', function () {
      settings.lineHeight = normalizeNumericSetting(this.value, numericSettingRanges.lineHeight);
      updateSettingLabels();
      applyReaderSettings();
      persistSettings();
    });

    elements.pageMarginInput.addEventListener('input', function () {
      settings.pageMargin = normalizeNumericSetting(this.value, numericSettingRanges.pageMargin);
      updateSettingLabels();
      applyReaderSettings();
      persistSettings();
    });

    elements.layoutSelect.addEventListener('change', function () {
      settings.layout = this.value;
      applyReaderSettings();
      persistSettings();
    });

    elements.disableDyslibriaInput.addEventListener('change', function () {
      settings.disableDyslibria = this.checked;
      applyReaderSettings();
      persistSettings();
    });

    window.addEventListener('resize', function () {
      applyReaderSettings();
    });

    elements.viewerFrame.addEventListener('click', handleShellSurfaceInteraction);
    elements.viewerFrame.addEventListener('touchend', handleShellSurfaceInteraction, { passive: false });

    window.addEventListener('popstate', function () {
      if (uiState.overlay && uiState.overlayHistoryActive) {
        closeOverlay({ fromHistory: true });
      }
    });
  }

  async function initialiseReader() {
    if (!fileName) {
      updateMetadata('No EPUB selected', 'Open a book from the dashboard first.');
      setLoadingState('No EPUB selected', 'Open a book from the dashboard first.');
      setLoadingProgress(0, 'Open a book from the library first.');
      elements.chapterLabel.textContent = 'No file parameter was provided.';
      elements.progressDetail.textContent = 'Open a book from the library first.';
      openOverlay('settings', { pushHistory: false });
      return;
    }

    await loadAppConfig();
    renderThemeChoices();
    renderFontChoices();
    updateSettingLabels();
    applyShellTheme();
    applyViewerMargins();
    attachEventListeners();

    try {
      setLoadingProgress(8, 'Checking saved position');
      const savedProgressPromise = fetchSavedProgress(fileName);
      setLoadingProgress(18, 'Loading EPUB package');
      const epubBuffer = await fetchEpubBuffer(fileName);
      setLoadingProgress(34, 'Preparing browser reader');
      book = ePub(epubBuffer);
      rendition = book.renderTo('viewer', {
        width: '100%',
        height: '100%',
        spread: getDisplaySpread(),
        minSpreadWidth: AUTO_SPREAD_MIN_WIDTH
      });

      if (rendition.hooks && rendition.hooks.content) {
        rendition.hooks.content.register(function (contents) {
          lockContentSelection(contents);
          applyContentPresentationOverrides(contents);
        });
      }

      applyReaderSettings();

      rendition.on('relocated', function (location) {
        updateProgress(location);
      });

      rendition.on('click', handleSurfaceInteraction);
      rendition.on('touchend', handleSurfaceInteraction);

      setLoadingProgress(48, 'Reading package metadata');
      await book.ready;
      readingDirection = (book.package && book.package.metadata && book.package.metadata.direction) || 'ltr';

      const metadata = (book.package && book.package.metadata) || {};
      updateMetadata(metadata.title, metadata.creator);

      setLoadingProgress(62, 'Loading table of contents');
      const navigation = await book.loaded.navigation;
      const tocEntries = Array.isArray(navigation) ? navigation : (navigation.toc || []);
      flatTocEntries = [];
      flattenTocEntries(tocEntries, flatTocEntries);

      try {
        setLoadingProgress(76, 'Building page map');
        await book.locations.generate(1600);
      } catch (error) {
        console.warn('Unable to generate reading locations before first render:', error);
      }

      setLoadingProgress(88, 'Restoring reading position');
      const savedProgress = await savedProgressPromise;
      applySavedProgress(savedProgress);

      const startingLocation = requestedLocation || (savedProgress && savedProgress.location) || getSavedLocalLocation();
      setLoadingProgress(96, 'Opening book');
      await rendition.display(startingLocation || undefined);
      applyReaderSettings();
      resizeRendition();
      setLoadingProgress(100, 'Ready to read');
      markLoaded();
      updateProgress(rendition.currentLocation());
    } catch (error) {
      console.error('Reader failed to load:', error);
      updateMetadata('Unable to open book', error.message);
      setLoadingState('Unable to open book', 'This EPUB could not be rendered in the browser.');
      setLoadingProgress(100, 'Rendering failed');
      elements.chapterLabel.textContent = 'This EPUB could not be rendered in the browser.';
      elements.progressDetail.textContent = 'This file could not be rendered in the browser reader.';
      openOverlay('settings', { pushHistory: false });
    }
  }

  initialiseReader();
})();
