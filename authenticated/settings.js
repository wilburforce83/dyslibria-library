$(document).ready(function () {
  const THEME_STORAGE_KEY = 'dyslibria:library-theme:v1';

  const state = {
    theme: localStorage.getItem(THEME_STORAGE_KEY) || 'dark',
    themeColorKey: (window.DyslibriaTheme && window.DyslibriaTheme.DEFAULT_COLOR_KEY) || 'ember',
    themeColorOptions: (window.DyslibriaTheme && window.DyslibriaTheme.COLOR_OPTIONS.slice()) || [],
    palette: null,
    session: null,
    settings: null,
    users: [],
    typographyProfiles: [],
    activeTypographySelection: null,
    typographySampleText: '',
    mobileMenuOpen: false,
    noticeTimer: null,
    pendingDeleteUser: null,
    currentVersion: '',
    latestVersion: '',
    updateAvailable: false,
    updateNoticeShown: false
  };

  const $app = $('#settingsApp');
  const $settingsNotice = $('#settingsNotice');
  const $settingsNoticeTitle = $('#settingsNoticeTitle');
  const $settingsNoticeCopy = $('#settingsNoticeCopy');
  const $dismissSettingsNotice = $('#dismissSettingsNotice');
  const $currentUserBadge = $('#currentUserBadge');
  const $themeModeBadge = $('#themeModeBadge');
  const $settingsHeading = $('#settingsHeading');
  const $settingsIntroCopy = $('#settingsIntroCopy');
  const $setupShell = $('#setupShell');
  const $standardSettingsShell = $('#standardSettingsShell');
  const $profileUsername = $('#profileUsername');
  const $profileRole = $('#profileRole');
  const $profileStatus = $('#profileStatus');
  const $generalSection = $('#generalSection');
  const $typographySection = $('#typographySection');
  const $usersSection = $('#usersSection');
  const $dangerSection = $('#dangerSection');
  const $themeColorSelect = $('#themeColorSelect');
  const $userList = $('#userList');
  const $activeTypographyLabel = $('#activeTypographyLabel');
  const $activeTypographyDescription = $('#activeTypographyDescription');
  const $activeTypographyBadge = $('#activeTypographyBadge');
  const $typographyProfileGrid = $('#typographyProfileGrid');
  const $typographyFileInput = $('#typographyFileInput');
  const $typographyJsonInput = $('#typographyJsonInput');
  const $backToLibraryButton = $('#backToLibraryButton');
  const $settingsInstallButton = $('#settingsInstallButton');
  const $settingsMenuToggle = $('#settingsMenuToggle');
  const $settingsHeaderActions = $('#settingsHeaderActions');
  const $deleteLibraryProgressCheckbox = $('#deleteLibraryProgressCheckbox');
  const $deleteLibraryProgressNote = $('#deleteLibraryProgressNote');
  const $deleteLibraryConfirmModal = $('#deleteLibraryConfirmModal');
  const $deleteLibraryConfirmCopy = $('#deleteLibraryConfirmCopy');
  const $deleteLibraryConfirmNote = $('#deleteLibraryConfirmNote');
  const $confirmDeleteLibraryButton = $('#confirmDeleteLibraryButton');
  const $deleteUserConfirmModal = $('#deleteUserConfirmModal');
  const $deleteUserConfirmCopy = $('#deleteUserConfirmCopy');
  const $confirmDeleteUserButton = $('#confirmDeleteUserButton');

  if (window.DyslibriaPwa) {
    window.DyslibriaPwa.bindInstallButton($settingsInstallButton.get(0));
  }

  function setButtonBusy($button, busy) {
    $button.prop('disabled', busy);
    $button.toggleClass('loading', busy);
  }

  function clearNotice() {
    if (state.noticeTimer) {
      window.clearTimeout(state.noticeTimer);
      state.noticeTimer = null;
    }

    $settingsNotice.prop('hidden', true).addClass('hidden').removeClass('is-success is-error');
  }

  function showNotice(message, tone, options) {
    const variant = tone || 'info';
    const config = options || {};
    const timeout = config.timeout === undefined ? (variant === 'error' ? 7000 : 5000) : config.timeout;

    if (state.noticeTimer) {
      window.clearTimeout(state.noticeTimer);
      state.noticeTimer = null;
    }

    $settingsNoticeTitle.text(config.title || (variant === 'error' ? 'Something went wrong' : 'Updated'));
    $settingsNoticeCopy.text(message);
    $settingsNotice
      .prop('hidden', false)
      .removeClass('hidden is-success is-error')
      .toggleClass('is-success', variant === 'success')
      .toggleClass('is-error', variant === 'error');

    if (timeout > 0) {
      state.noticeTimer = window.setTimeout(clearNotice, timeout);
    }
  }

  function closeMobileMenu() {
    state.mobileMenuOpen = false;
    $settingsHeaderActions.removeClass('is-open');
    $settingsMenuToggle.attr('aria-expanded', 'false');
  }

  function formatRelativeTime(value) {
    const timestamp = Date.parse(value || '');
    if (!timestamp) {
      return 'No recorded login yet';
    }

    const diffMs = Date.now() - timestamp;
    const diffMinutes = Math.max(1, Math.round(diffMs / 60000));

    if (diffMinutes < 60) {
      return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
    }

    const diffHours = Math.round(diffMinutes / 60);
    if (diffHours < 24) {
      return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    }

    const diffDays = Math.round(diffHours / 24);
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  }

  function createTypographySelectionKey(profile) {
    if (!profile) {
      return '';
    }

    return `${profile.type}:${profile.id}`;
  }

  function scopeTypographyPreviewCss(cssText, scopeSelector) {
    const source = String(cssText || '').trim();
    if (!source) {
      return '';
    }

    return source.replace(/(^|})\s*([^@{}][^{}]*)\{/g, function (_, boundary, selectors) {
      const scopedSelectors = selectors
        .split(',')
        .map(function (selector) {
          const trimmedSelector = selector.trim();
          return trimmedSelector ? `${scopeSelector} ${trimmedSelector}` : '';
        })
        .filter(Boolean)
        .join(',\n');

      return `${boundary}\n${scopedSelectors} {`;
    });
  }

  function createTypographyPreviewMarkup(profile, index) {
    const preview = profile && profile.preview ? profile.preview : {};
    const previewScopeId = `typography-preview-${String(profile.type || 'preset')}-${String(profile.id || index + 1)
      .replace(/[^a-z0-9_-]+/gi, '-')
      .toLowerCase()}-${index + 1}`;
    const scopeSelector = `[data-typography-preview-scope="${previewScopeId}"]`;
    const scopedCss = scopeTypographyPreviewCss(preview.css, scopeSelector);

    return `${scopedCss ? `<style>${scopedCss}</style>` : ''}<div class="typography-preview-canvas" data-typography-preview-scope="${previewScopeId}">${preview.html || ''}</div>`;
  }

  function renderTypographyProfiles() {
    $typographyProfileGrid.empty();

    if (!state.typographyProfiles.length) {
      $activeTypographyLabel.text('No typography profiles available');
      $activeTypographyDescription.text('Import a custom Dyslibria profile JSON or restore the built-in presets.');
      $activeTypographyBadge.text('Unavailable');
      $typographyProfileGrid.append(
        $('<div>').addClass('user-card').append(
          $('<p>').text('No typography profiles are available yet.')
        )
      );
      return;
    }

    const activeSelectionKey = createTypographySelectionKey(state.activeTypographySelection);
    const activeProfile = state.typographyProfiles.find(function (profile) {
      return createTypographySelectionKey(profile) === activeSelectionKey;
    }) || state.typographyProfiles[0];

    $activeTypographyLabel.text(activeProfile.label);
    $activeTypographyDescription.text(
      activeProfile.description || 'Dyslibria will use this profile for future EPUB conversions.'
    );
    $activeTypographyBadge.text(`Active: ${activeProfile.label}`);

    state.typographyProfiles.forEach(function (profile, index) {
      const isActive = createTypographySelectionKey(profile) === activeSelectionKey;
      const previewMarkup = createTypographyPreviewMarkup(profile, index);
      const $card = $('<article>')
        .addClass('typography-card')
        .toggleClass('is-active', isActive)
        .attr('data-profile-type', profile.type)
        .attr('data-profile-id', profile.id);
      const $header = $('<div>').addClass('typography-card-header');
      const $heading = $('<div>').addClass('typography-card-copy');
      const $badgeRow = $('<div>').addClass('typography-card-badges');
      const $title = $('<h3>').text(profile.label);
      const $description = $('<p>').text(profile.description || 'Dyslibria typography profile');
      const $preview = $('<div>').addClass('typography-preview').html(previewMarkup);
      const $meta = $('<div>').addClass('typography-meta');
      const $actions = $('<div>').addClass('section-actions');
      const $selectButton = $('<button>')
        .addClass(`ui button app-button ${isActive ? 'ghost' : 'accent'} use-typography-button`)
        .attr('type', 'button')
        .text(isActive ? 'Selected for conversion' : 'Use for new conversions')
        .prop('disabled', isActive);

      $badgeRow.append(
        $('<span>').addClass('meta-pill').text(profile.isCustom ? 'Custom' : 'Built-in')
      );

      if (profile.isDefaultPreset) {
        $badgeRow.append(
          $('<span>').addClass('meta-pill').text('Dyslibria default')
        );
      }

      if (isActive) {
        $badgeRow.append(
          $('<span>').addClass('meta-pill').text('Active')
        );
      }

      if (profile.isCustom && profile.sourceKind) {
        $meta.append(
          $('<span>').text(
            profile.sourceKind === 'reader-configuration'
              ? 'Imported from reader configuration'
              : 'Imported from profile JSON'
          )
        );
      }

      if (profile.importedFilename) {
        $meta.append(
          $('<span>').text(`File: ${profile.importedFilename}`)
        );
      }

      if (profile.createdAt) {
        $meta.append(
          $('<span>').text(`Added ${new Date(profile.createdAt).toLocaleString()}`)
        );
      }

      if (Array.isArray(profile.warnings) && profile.warnings.length) {
        $meta.append(
          $('<span>').text(`${profile.warnings.length} normalization warning${profile.warnings.length === 1 ? '' : 's'}`)
        );
      }

      $heading.append($badgeRow, $title, $description);
      $header.append($heading);
      $actions.append($selectButton);

      if (profile.isCustom) {
        $actions.append(
          $('<button>')
            .addClass('ui button app-button ghost delete-typography-button')
            .attr('type', 'button')
            .text('Delete custom profile')
        );
      }

      $card.append($header, $preview);

      if ($meta.children().length) {
        $card.append($meta);
      }

      $card.append($actions);
      $typographyProfileGrid.append($card);
    });
  }

  function populateThemeColorOptions() {
    $themeColorSelect.empty();

    state.themeColorOptions.forEach(function (option) {
      const $option = $('<option>')
        .attr('value', option.key)
        .text(option.label);

      if (option.key === state.themeColorKey) {
        $option.prop('selected', true);
      }

      $themeColorSelect.append($option);
    });
  }

  function applyAccentPalette() {
    if (!window.DyslibriaTheme) {
      return;
    }

    state.palette = window.DyslibriaTheme.applyPalette(state.themeColorKey, document.documentElement);
    $('meta[name="theme-color"]').attr(
      'content',
      window.DyslibriaTheme.getMetaThemeColor(state.theme, state.palette)
    );
  }

  function applyTheme() {
    const isDark = state.theme === 'dark';
    document.body.classList.toggle('theme-dark', isDark);
    document.body.classList.toggle('theme-light', !isDark);
    $app.toggleClass('theme-dark', isDark);
    $app.toggleClass('theme-light', !isDark);
    $themeModeBadge.text(isDark ? 'Dark theme' : 'Light theme');
    applyAccentPalette();
    localStorage.setItem(THEME_STORAGE_KEY, state.theme);
  }

  function renderSession() {
    if (!state.session || !state.session.user) {
      return;
    }

    const user = state.session.user;
    const isSetup = user.mustSetup === true;

    $currentUserBadge.text(isSetup ? 'Bootstrap administrator' : `${user.username} · ${user.role}`);
    $profileUsername.text(user.username);
    $profileRole.text(isSetup ? 'Bootstrap setup session' : `${user.role === 'admin' ? 'Administrator' : 'Reader'} account`);
    $profileStatus.text(user.isActive === false ? 'Inactive' : 'Active');

    $setupShell.prop('hidden', !isSetup);
    $standardSettingsShell.prop('hidden', isSetup);
    $backToLibraryButton.toggle(!isSetup);

    if (isSetup) {
      closeMobileMenu();
    }

    if (isSetup) {
      $settingsHeading.text('Initial setup');
      $settingsIntroCopy.text('Create the permanent administrator account and finish the first-run bootstrap flow.');
      return;
    }

    $settingsHeading.text('Settings');
    $settingsIntroCopy.text('Manage system defaults, account access, and install behaviour from one place.');
    $generalSection.prop('hidden', user.role !== 'admin');
    $typographySection.prop('hidden', user.role !== 'admin');
    $usersSection.prop('hidden', user.role !== 'admin');
    $dangerSection.prop('hidden', user.role !== 'admin');
  }

  function maybeShowUpdateNotice() {
    if (state.updateNoticeShown || !state.session || !state.session.canManageSystem || !state.updateAvailable) {
      return;
    }

    if (!state.currentVersion || !state.latestVersion) {
      return;
    }

    showNotice(`Version ${state.latestVersion} is available. You're running ${state.currentVersion}.`, 'info', {
      title: 'Update available',
      timeout: 0
    });
    state.updateNoticeShown = true;
  }

  function loadUpdateStatus() {
    if (!state.session || !state.session.canManageSystem) {
      return $.Deferred().resolve().promise();
    }

    return $.get('/api/update-status').then(function (payload) {
      state.currentVersion = (payload && payload.currentVersion) || state.currentVersion;
      state.latestVersion = (payload && payload.latestVersion) || '';
      state.updateAvailable = Boolean(payload && payload.updateAvailable);
      maybeShowUpdateNotice();
    }).catch(function () {
      state.latestVersion = '';
      state.updateAvailable = false;
    });
  }

  function updateDeleteLibraryProgressNote() {
    if ($deleteLibraryProgressCheckbox.prop('checked')) {
      $deleteLibraryProgressNote.text('Reading progress will be removed for everyone as part of this reset.');
      return;
    }

    $deleteLibraryProgressNote.text(
      'If you leave this unticked, saved reading progress stays on the server and returns when the same book filename is uploaded again.'
    );
  }

  function renderUsers() {
    $userList.empty();

    if (!state.users.length) {
      $userList.append(
        $('<div>').addClass('user-card').append(
          $('<p>').text('No user accounts found yet.')
        )
      );
      return;
    }

    state.users.forEach(function (user) {
      const isSelf = state.session && state.session.user && state.session.user.id === user.id;

      const $card = $('<article>').addClass('user-card').attr('data-user-id', user.id);
      const $header = $('<div>').addClass('user-card-header');
      const $titleBlock = $('<div>');
      const $title = $('<h3>').text(user.username);
      const $meta = $('<p>').addClass('user-card-meta').text(
        `${user.role === 'admin' ? 'Administrator' : 'Reader'} · Last login ${formatRelativeTime(user.lastLoginAt)}`
      );
      const $badge = $('<span>').addClass('meta-pill').text(user.isActive === false ? 'Inactive' : 'Active');

      const $grid = $('<div>').addClass('ui form user-card-grid');
      const $roleField = $('<div>').addClass('field');
      const $roleSelect = $('<select>').addClass('user-role')
        .append($('<option>').val('reader').text('Reader'))
        .append($('<option>').val('admin').text('Administrator'))
        .val(user.role);
      const $statusField = $('<div>').addClass('field');
      const $statusSelect = $('<select>').addClass('user-status')
        .append($('<option>').val('true').text('Active'))
        .append($('<option>').val('false').text('Inactive'))
        .val(user.isActive === false ? 'false' : 'true');
      const $passwordField = $('<div>').addClass('field');
      const $passwordInput = $('<input>').attr({
        type: 'password',
        placeholder: 'Leave blank to keep current password'
      }).addClass('user-password');

      $roleField.append($('<label>').text('Role'), $roleSelect);
      $statusField.append($('<label>').text('Status'), $statusSelect);
      $passwordField.append($('<label>').text('Reset password'), $passwordInput);
      $grid.append($roleField, $statusField, $passwordField);

      const $actions = $('<div>').addClass('section-actions');
      const $saveButton = $('<button>').addClass('ui button app-button accent save-user-button').attr('type', 'button').text('Save account');
      const $deleteButton = $('<button>').addClass('ui button app-button ghost delete-user-button').attr('type', 'button').text('Delete user');

      if (isSelf) {
        $deleteButton.prop('disabled', true).text('Current account');
      }

      $actions.append($saveButton, $deleteButton);

      const $footer = $('<p>').addClass('user-card-footer').text(
        user.createdAt ? `Created ${new Date(user.createdAt).toLocaleString()}` : 'Creation time unavailable'
      );

      $titleBlock.append($title, $meta);
      $header.append($titleBlock, $badge);
      $card.append($header, $grid, $actions, $footer);
      $userList.append($card);
    });
  }

  function loadAppConfig() {
    return $.get('/api/app-config').then(function (payload) {
      const themeColors = Array.isArray(payload && payload.themeColors) ? payload.themeColors : [];
      if (themeColors.length) {
        state.themeColorOptions = themeColors;
      }

      state.currentVersion = (payload && payload.currentVersion) || '';
      state.themeColorKey = (payload && payload.themeColor) || state.themeColorKey;
      populateThemeColorOptions();
      applyTheme();
      maybeShowUpdateNotice();
    }).catch(function () {
      populateThemeColorOptions();
      applyTheme();
    });
  }

  function loadSession() {
    return $.get('/api/session').then(function (payload) {
      state.session = payload || {};
      renderSession();
      loadUpdateStatus();
      maybeShowUpdateNotice();
    });
  }

  function loadGeneralSettings() {
    if (!state.session || !state.session.canManageSystem) {
      return $.Deferred().resolve().promise();
    }

    return $.get('/settings').then(function (data) {
      state.settings = data || {};
      if (Array.isArray(data.themeColors) && data.themeColors.length) {
        state.themeColorOptions = data.themeColors;
      }

      state.themeColorKey = data.themeColor || state.themeColorKey;
      populateThemeColorOptions();
      $('input[name="webdavPort"]').val(data.webdavPort);
      $('input[name="opdsPort"]').val(data.opdsPort);
      $('input[name="uploadPath"]').val(data.uploadPath);
      $('input[name="libraryPath"]').val(data.libraryPath);
      $('input[name="baseUrl"]').val(data.baseUrl);
      $themeColorSelect.val(state.themeColorKey);
      applyTheme();
    });
  }

  function loadUsers() {
    if (!state.session || !state.session.canManageUsers || state.session.user.mustSetup) {
      return $.Deferred().resolve().promise();
    }

    return $.get('/api/users').then(function (payload) {
      state.users = Array.isArray(payload && payload.users) ? payload.users : [];
      renderUsers();
    });
  }

  function loadTypographyProfiles() {
    if (!state.session || !state.session.canManageSystem || state.session.user.mustSetup) {
      return $.Deferred().resolve().promise();
    }

    return $.get('/api/typography-profiles').then(function (payload) {
      state.typographyProfiles = Array.isArray(payload && payload.profiles) ? payload.profiles : [];
      state.activeTypographySelection = payload && payload.activeSelection ? payload.activeSelection : null;
      state.typographySampleText = (payload && payload.sampleText) || '';
      renderTypographyProfiles();
    });
  }

  function bindEvents() {
    $settingsMenuToggle.on('click', function () {
      state.mobileMenuOpen = !state.mobileMenuOpen;
      $settingsHeaderActions.toggleClass('is-open', state.mobileMenuOpen);
      $(this).attr('aria-expanded', String(state.mobileMenuOpen));
    });

    $settingsHeaderActions.on('click', 'a, button', function () {
      if (window.innerWidth <= 720) {
        closeMobileMenu();
      }
    });

    $dismissSettingsNotice.on('click', clearNotice);

    $('#setupForm').on('submit', function (event) {
      event.preventDefault();
      const $button = $('#completeSetupButton');
      const username = $(this).find('input[name="username"]').val();
      const password = $(this).find('input[name="password"]').val();
      const confirmPassword = $(this).find('input[name="confirmPassword"]').val();

      if (password !== confirmPassword) {
        showNotice('The passwords do not match.', 'error', {
          title: 'Check the passwords',
          timeout: 0
        });
        return;
      }

      setButtonBusy($button, true);

      $.post('/api/setup/admin', { username, password }, function () {
        window.location.href = '/authenticated/index.html';
      }).fail(function (xhr) {
        const message = (xhr.responseJSON && xhr.responseJSON.message) || 'Unable to complete the initial setup.';
        showNotice(message, 'error', {
          title: 'Setup could not finish',
          timeout: 0
        });
      }).always(function () {
        setButtonBusy($button, false);
      });
    });

    $('#passwordForm').on('submit', function (event) {
      event.preventDefault();
      const $button = $('#savePasswordButton');
      const currentPassword = $(this).find('input[name="currentPassword"]').val();
      const newPassword = $(this).find('input[name="newPassword"]').val();
      const confirmNewPassword = $(this).find('input[name="confirmNewPassword"]').val();

      if (newPassword !== confirmNewPassword) {
        showNotice('The new passwords do not match.', 'error', {
          title: 'Check the passwords',
          timeout: 0
        });
        return;
      }

      setButtonBusy($button, true);

      $.post('/api/account/password', { currentPassword, newPassword }, () => {
        this.reset();
        showNotice('Password updated.', 'success');
      }).fail(function (xhr) {
        const message = (xhr.responseJSON && xhr.responseJSON.message) || 'Unable to update the password.';
        showNotice(message, 'error', {
          title: 'Password was not updated',
          timeout: 0
        });
      }).always(function () {
        setButtonBusy($button, false);
      });
    });

    $('#generalSettingsForm').on('submit', function (event) {
      event.preventDefault();
      const $button = $('#saveGeneralSettingsButton');
      const payload = $(this).serialize();

      setButtonBusy($button, true);

      $.post('/settings', payload, function (response) {
        state.themeColorKey = $themeColorSelect.val() || state.themeColorKey;
        applyTheme();
        showNotice(
          response && response.requiresRestart
            ? 'Settings saved. Restart Dyslibria for path, port, or base URL changes to take effect.'
            : 'Settings saved.',
          'success'
        );
      }).fail(function (xhr) {
        const message = (xhr.responseJSON && xhr.responseJSON.message) || 'Unable to save settings.';
        showNotice(message, 'error', {
          title: 'Settings were not saved',
          timeout: 0
        });
      }).always(function () {
        setButtonBusy($button, false);
      });
    });

    $('#restartServerButton').on('click', function () {
      const $button = $(this);
      setButtonBusy($button, true);

      $.post('/restart-server', function () {
        showNotice('Server restart requested.', 'success');
      }).fail(function (xhr) {
        const message = (xhr.responseJSON && xhr.responseJSON.message) || 'Server restart is disabled or failed.';
        showNotice(message, 'error', {
          title: 'Restart could not be requested',
          timeout: 0
        });
      }).always(function () {
        setButtonBusy($button, false);
      });
    });

    $('#forceRefreshButton').on('click', function () {
      const $button = $(this);
      setButtonBusy($button, true);

      $.post('/update-database', function () {
        showNotice('Library metadata and cover images were rebuilt.', 'success');
      }).fail(function (xhr) {
        const message = (xhr.responseJSON && xhr.responseJSON.message) || 'Unable to refresh the library.';
        showNotice(message, 'error', {
          title: 'Refresh could not finish',
          timeout: 0
        });
      }).always(function () {
        setButtonBusy($button, false);
      });
    });

    $typographyFileInput.on('change', function (event) {
      const input = event.currentTarget;
      const file = input && input.files ? input.files[0] : null;

      if (!file) {
        return;
      }

      const reader = new FileReader();
      reader.onload = function (loadEvent) {
        const result = loadEvent && loadEvent.target ? loadEvent.target.result : '';
        $typographyJsonInput.val(String(result || ''));

        const currentLabel = String($('input[name="label"]', '#typographyImportForm').val() || '').trim();
        if (!currentLabel) {
          const fallbackLabel = String(file.name || '').replace(/\.json$/i, '');
          $('input[name="label"]', '#typographyImportForm').val(fallbackLabel);
        }
      };
      reader.onerror = function () {
        showNotice('The JSON file could not be read on this device.', 'error', {
          title: 'Import failed',
          timeout: 0
        });
      };
      reader.readAsText(file);
    });

    $('#clearTypographyJsonButton').on('click', function () {
      $('#typographyImportForm').get(0).reset();
      $typographyJsonInput.val('');
    });

    $('#typographyImportForm').on('submit', function (event) {
      event.preventDefault();
      const $button = $('#importTypographyButton');
      const file = $typographyFileInput.get(0) && $typographyFileInput.get(0).files
        ? $typographyFileInput.get(0).files[0]
        : null;
      const payload = {
        label: $(this).find('input[name="label"]').val(),
        profileJson: String($typographyJsonInput.val() || ''),
        filename: file ? file.name : ''
      };

      setButtonBusy($button, true);

      $.post('/api/typography-profiles/custom', payload, function (response) {
        $('#typographyImportForm').get(0).reset();
        $typographyJsonInput.val('');
        showNotice(`Added ${response && response.profile && response.profile.label ? response.profile.label : 'the custom profile'}.`, 'success');
        loadTypographyProfiles();
      }).fail(function (xhr) {
        const message = (xhr.responseJSON && xhr.responseJSON.message) || 'Unable to import the custom typography profile.';
        showNotice(message, 'error', {
          title: 'Profile import failed',
          timeout: 0
        });
      }).always(function () {
        setButtonBusy($button, false);
      });
    });

    $typographyProfileGrid.on('click', '.use-typography-button', function () {
      const $button = $(this);
      const $card = $button.closest('.typography-card');
      const payload = {
        type: $card.data('profile-type'),
        id: $card.data('profile-id')
      };

      setButtonBusy($button, true);

      $.post('/api/typography-profiles/selection', payload, function (response) {
        state.activeTypographySelection = response && response.activeSelection ? response.activeSelection : payload;
        showNotice(`New uploads will use ${state.activeTypographySelection.label || 'the selected profile'}.`, 'success');
        loadTypographyProfiles();
      }).fail(function (xhr) {
        const message = (xhr.responseJSON && xhr.responseJSON.message) || 'Unable to select the Dyslibria typography profile.';
        showNotice(message, 'error', {
          title: 'Profile was not selected',
          timeout: 0
        });
      }).always(function () {
        setButtonBusy($button, false);
      });
    });

    $typographyProfileGrid.on('click', '.delete-typography-button', function () {
      const $button = $(this);
      const $card = $button.closest('.typography-card');
      const profileId = $card.data('profile-id');
      const profileLabel = String($card.find('h3').text() || 'this custom profile');

      if (!window.confirm(`Delete "${profileLabel}" from Dyslibria typography profiles?`)) {
        return;
      }

      setButtonBusy($button, true);

      $.ajax({
        url: `/api/typography-profiles/custom/${encodeURIComponent(profileId)}`,
        type: 'DELETE',
        success: function (response) {
          showNotice(`Deleted ${profileLabel}.`, 'success');
          state.activeTypographySelection = response && response.activeSelection ? response.activeSelection : state.activeTypographySelection;
          loadTypographyProfiles();
        },
        error: function (xhr) {
          const message = (xhr.responseJSON && xhr.responseJSON.message) || 'Unable to delete the custom typography profile.';
          showNotice(message, 'error', {
            title: 'Profile could not be deleted',
            timeout: 0
          });
        },
        complete: function () {
          setButtonBusy($button, false);
        }
      });
    });

    $deleteLibraryProgressCheckbox.on('change', updateDeleteLibraryProgressNote);

    $('#deleteAllBooksButton').on('click', function () {
      const removeReadingProgress = $deleteLibraryProgressCheckbox.prop('checked');

      $deleteLibraryConfirmCopy.text(
        removeReadingProgress
          ? 'Delete every book from the library and remove all saved reading progress?'
          : 'Delete every book from the library?'
      );
      $deleteLibraryConfirmNote.text(
        removeReadingProgress
          ? 'This will remove the EPUB files and clear saved reading locations for everyone.'
          : 'Saved reading progress will stay on the server and can return if the same book filename is uploaded again.'
      );

      $deleteLibraryConfirmModal.modal({
        closable: false,
        autofocus: false
      }).modal('show');
    });

    $('#cancelDeleteLibraryButton').on('click', function () {
      $deleteLibraryConfirmModal.modal('hide');
    });

    $confirmDeleteLibraryButton.on('click', function () {
      const removeReadingProgress = $deleteLibraryProgressCheckbox.prop('checked');
      const $button = $(this);

      setButtonBusy($button, true);

      $.ajax({
        url: '/api/books',
        type: 'DELETE',
        data: {
          removeReadingProgress
        },
        success: function (response) {
          $deleteLibraryConfirmModal.modal('hide');
          showNotice(
            response && response.deletedCount === 0
              ? (
                removeReadingProgress
                  ? 'The library was already empty. Saved reading progress has been cleared.'
                  : 'The library was already empty.'
              )
              : (
                removeReadingProgress
                  ? `Deleted ${response.deletedCount} book${response.deletedCount === 1 ? '' : 's'} and cleared all reading progress.`
                  : `Deleted ${response.deletedCount} book${response.deletedCount === 1 ? '' : 's'}. Saved reading progress was kept.`
              )
            ,
            'success'
          );
        },
        error: function (xhr) {
          const message = (xhr.responseJSON && xhr.responseJSON.message) || 'Unable to delete the library contents.';
          showNotice(message, 'error', {
            title: 'Library could not be deleted',
            timeout: 0
          });
        },
        complete: function () {
          setButtonBusy($button, false);
        }
      });
    });

    $('#createUserForm').on('submit', function (event) {
      event.preventDefault();
      const $button = $('#createUserButton');
      const payload = {
        username: $(this).find('input[name="username"]').val(),
        password: $(this).find('input[name="password"]').val(),
        role: $(this).find('select[name="role"]').val()
      };

      setButtonBusy($button, true);

      $.post('/api/users', payload, function () {
        $('#createUserForm').get(0).reset();
        showNotice(`Added ${payload.username}.`, 'success');
        loadUsers();
      }).fail(function (xhr) {
        const message = (xhr.responseJSON && xhr.responseJSON.message) || 'Unable to create the user.';
        showNotice(message, 'error', {
          title: 'User could not be created',
          timeout: 0
        });
      }).always(function () {
        setButtonBusy($button, false);
      });
    });

    $userList.on('click', '.save-user-button', function () {
      const $button = $(this);
      const $card = $button.closest('.user-card');
      const userId = $card.data('user-id');
      const payload = {
        role: $card.find('.user-role').val(),
        isActive: $card.find('.user-status').val(),
        password: $card.find('.user-password').val()
      };

      setButtonBusy($button, true);

      $.ajax({
        url: `/api/users/${encodeURIComponent(userId)}`,
        type: 'PATCH',
        data: payload,
        success: function () {
          showNotice('Account updated.', 'success');
          loadUsers();
        },
        error: function (xhr) {
          const message = (xhr.responseJSON && xhr.responseJSON.message) || 'Unable to update the user.';
          showNotice(message, 'error', {
            title: 'Account could not be updated',
            timeout: 0
          });
        },
        complete: function () {
          setButtonBusy($button, false);
        }
      });
    });

    $userList.on('click', '.delete-user-button', function () {
      const $button = $(this);
      if ($button.prop('disabled')) {
        return;
      }

      const $card = $button.closest('.user-card');
      const userId = $card.data('user-id');
      const username = String($card.find('h3').text() || 'this user');

      state.pendingDeleteUser = {
        id: userId,
        username,
        button: $button
      };

      $deleteUserConfirmCopy.text(`Delete "${username}" from Dyslibria?`);
      $deleteUserConfirmModal.modal({
        closable: false,
        autofocus: false,
        onHidden: function () {
          if (state.pendingDeleteUser && state.pendingDeleteUser.button) {
            setButtonBusy(state.pendingDeleteUser.button, false);
          }

          setButtonBusy($confirmDeleteUserButton, false);
          state.pendingDeleteUser = null;
        }
      }).modal('show');
    });

    $('#cancelDeleteUserButton').on('click', function () {
      $deleteUserConfirmModal.modal('hide');
    });

    $confirmDeleteUserButton.on('click', function () {
      const pendingDeleteUser = state.pendingDeleteUser;
      const $button = $(this);

      if (!pendingDeleteUser || !pendingDeleteUser.id) {
        return;
      }

      setButtonBusy($button, true);
      setButtonBusy(pendingDeleteUser.button, true);

      $.ajax({
        url: `/api/users/${encodeURIComponent(pendingDeleteUser.id)}`,
        type: 'DELETE',
        success: function () {
          $deleteUserConfirmModal.modal('hide');
          showNotice(`Deleted ${pendingDeleteUser.username}.`, 'success');
          loadUsers();
        },
        error: function (xhr) {
          const message = (xhr.responseJSON && xhr.responseJSON.message) || 'Unable to delete the user.';
          showNotice(message, 'error', {
            title: 'User could not be deleted',
            timeout: 0
          });
        },
        complete: function () {
          setButtonBusy($button, false);

          if (state.pendingDeleteUser && state.pendingDeleteUser.button) {
            setButtonBusy(state.pendingDeleteUser.button, false);
          }
        }
      });
    });

    $(window).on('resize', function () {
      if (window.innerWidth > 720) {
        closeMobileMenu();
      }
    });

    $(document).on('keydown', function (event) {
      if (event.key === 'Escape') {
        closeMobileMenu();
      }
    });
  }

  function initialise() {
    bindEvents();
    updateDeleteLibraryProgressNote();

    $.when(loadAppConfig(), loadSession()).then(function () {
      if (state.session && state.session.canManageSystem) {
        return $.when(loadGeneralSettings(), loadTypographyProfiles(), loadUsers());
      }

      return $.Deferred().resolve().promise();
    }).fail(function () {
      showNotice('Unable to load the settings page.', 'error', {
        title: 'Settings did not load',
        timeout: 0
      });
    });
  }

  initialise();
});
