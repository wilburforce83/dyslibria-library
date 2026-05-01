const crypto = require('crypto');
const {
  applyDyslibriaProfile,
  createProfileFromPreset,
  DEFAULT_PRESET_ID,
  PROFILE_PRESETS,
  resolvePresetId,
  validateAndNormalizeProfile
} = require('dyslibria-converter');

const CUSTOM_PROFILE_ID_PREFIX = 'custom-';
const TYPOGRAPHY_PREVIEW_TEXT = [
  'It was on a dreary night of November that I beheld the accomplishment of my toils, and the rain pattered against the panes while the candle burned low.',
  '',
  'With anxious care I watched the room grow still, waiting to see whether the creature before me would wake and move.'
].join('\n');

const BUILTIN_PRESET_COPY = {
  'intense-scaffolding': {
    description: 'Whole-word highlighting with stronger structural guidance, calmer spacing, and the fullest default Dyslibria support.'
  },
  'dyslibria-balanced': {
    description: 'Lighter whole-word guidance with calm spacing for readers who want support without heavy scaffolding.'
  },
  'dense-text-support': {
    description: 'Whole-word guidance tuned for denser, information-heavy pages so longer paragraphs stay easier to track.'
  },
  'focus-support': {
    description: 'Shorter lines, extra breathing room, and low-noise whole-word cues to help reduce crowding and hold your place.'
  },
  'dyslexia-spacing': {
    description: 'Extra letter, word, and line spacing paired with restrained whole-word cueing for clearer visual separation.'
  },
  'front-load-emphasis': {
    description: 'Experimental prefix emphasis that highlights the start of each word instead of the whole word.'
  }
};

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function sanitizeLabel(value, fallback) {
  const trimmedValue = String(value || '').trim();
  if (trimmedValue) {
    return trimmedValue.slice(0, 120);
  }

  return fallback;
}

function createStableCustomProfileId(record, fallbackLabel) {
  const hash = crypto
    .createHash('sha1')
    .update(JSON.stringify(record.profile || {}))
    .update('|')
    .update(String(record.label || fallbackLabel || 'custom-profile'))
    .digest('hex')
    .slice(0, 12);

  return `${CUSTOM_PROFILE_ID_PREFIX}${hash}`;
}

function extractProfilePayload(input) {
  if (!isObject(input)) {
    throw new Error('Profile JSON must be a JSON object.');
  }

  if (isObject(input.profile)) {
    return {
      profile: input.profile,
      sourceKind: input.kind === 'dyslibria-reader-configuration'
        ? 'reader-configuration'
        : 'profile-wrapper',
      suggestedLabel: sanitizeLabel(
        input.readerLabel || input.profile.name,
        'Imported Dyslibria profile'
      )
    };
  }

  return {
    profile: input,
    sourceKind: 'profile',
    suggestedLabel: sanitizeLabel(input.name, 'Imported Dyslibria profile')
  };
}

function normalizeStoredCustomTypographyProfile(record, index = 0) {
  if (!isObject(record)) {
    return null;
  }

  const extracted = extractProfilePayload(record.profile || record.rawProfile || record);
  const validation = validateAndNormalizeProfile(extracted.profile);
  const normalizedProfile = validation.profile;
  const fallbackLabel = `Custom profile ${index + 1}`;
  const label = sanitizeLabel(record.label || extracted.suggestedLabel || normalizedProfile.name, fallbackLabel);
  const id = String(record.id || '').trim() || createStableCustomProfileId({
    label,
    profile: normalizedProfile
  }, fallbackLabel);

  return {
    id,
    label,
    description: sanitizeLabel(
      record.description || normalizedProfile.description || 'Imported custom Dyslibria conversion profile.',
      'Imported custom Dyslibria conversion profile.'
    ),
    sourceKind: String(record.sourceKind || extracted.sourceKind || 'profile').trim(),
    importedFilename: sanitizeLabel(record.importedFilename, ''),
    createdAt: String(record.createdAt || '').trim() || new Date().toISOString(),
    updatedAt: String(record.updatedAt || '').trim() || new Date().toISOString(),
    warnings: Array.isArray(record.warnings) ? record.warnings.map((warning) => String(warning)) : validation.warnings,
    profile: normalizedProfile
  };
}

function normalizeStoredCustomTypographyProfiles(records) {
  if (!Array.isArray(records)) {
    return [];
  }

  return records
    .map((record, index) => normalizeStoredCustomTypographyProfile(record, index))
    .filter(Boolean);
}

function getBuiltinPresetDisplayContent(presetId, profile) {
  const override = BUILTIN_PRESET_COPY[presetId] || {};

  return {
    label: sanitizeLabel(override.label || profile.name, profile.name || 'Dyslibria preset'),
    description: sanitizeLabel(
      override.description || profile.description || 'Dyslibria conversion profile.',
      'Dyslibria conversion profile.'
    )
  };
}

function importCustomTypographyProfile({ label, filename, profileJson }) {
  const rawJson = String(profileJson || '').trim();
  if (!rawJson) {
    throw new Error('Paste or upload a Dyslibria profile JSON file first.');
  }

  let parsedInput;
  try {
    parsedInput = JSON.parse(rawJson);
  } catch (error) {
    throw new Error('The custom profile JSON could not be parsed.');
  }

  const extracted = extractProfilePayload(parsedInput);
  const validation = validateAndNormalizeProfile(extracted.profile);
  const normalizedProfile = validation.profile;
  const importedFilename = sanitizeLabel(filename, '');
  const fallbackLabel = sanitizeLabel(
    importedFilename ? importedFilename.replace(/\.json$/i, '') : extracted.suggestedLabel,
    normalizedProfile.name || 'Imported Dyslibria profile'
  );
  const finalLabel = sanitizeLabel(label, fallbackLabel);
  const timestamp = new Date().toISOString();

  return {
    id: `${CUSTOM_PROFILE_ID_PREFIX}${crypto.randomUUID()}`,
    label: finalLabel,
    description: sanitizeLabel(
      normalizedProfile.description || 'Imported custom Dyslibria conversion profile.',
      'Imported custom Dyslibria conversion profile.'
    ),
    sourceKind: extracted.sourceKind,
    importedFilename,
    createdAt: timestamp,
    updatedAt: timestamp,
    warnings: validation.warnings,
    profile: normalizedProfile
  };
}

function resolveBuiltinPresetSelection(presetId) {
  const resolvedPresetId = resolvePresetId(presetId) || DEFAULT_PRESET_ID;
  const presetProfile = createProfileFromPreset(resolvedPresetId);
  const displayContent = getBuiltinPresetDisplayContent(resolvedPresetId, presetProfile);

  return {
    type: 'preset',
    id: resolvedPresetId,
    label: displayContent.label,
    description: displayContent.description,
    warnings: [],
    profile: presetProfile
  };
}

function resolveTypographySelection(rawSelection, customProfiles, options = {}) {
  const settings = options || {};
  const selection = isObject(rawSelection) ? rawSelection : {};
  const selectionType = String(selection.type || '').trim().toLowerCase();
  const selectionId = String(selection.id || '').trim();

  if (selectionType === 'custom' && selectionId) {
    const matchingCustomProfile = customProfiles.find((profile) => profile.id === selectionId);
    if (matchingCustomProfile) {
      return {
        type: 'custom',
        id: matchingCustomProfile.id,
        label: matchingCustomProfile.label,
        description: matchingCustomProfile.description,
        warnings: matchingCustomProfile.warnings,
        profile: clone(matchingCustomProfile.profile),
        sourceKind: matchingCustomProfile.sourceKind
      };
    }

    if (settings.strict) {
      throw new Error('The selected custom typography profile no longer exists.');
    }
  }

  if ((selectionType === 'preset' || !selectionType) && selectionId) {
    const resolvedPresetId = resolvePresetId(selectionId);
    if (resolvedPresetId) {
      return resolveBuiltinPresetSelection(resolvedPresetId);
    }

    if (settings.strict) {
      throw new Error('The selected Dyslibria preset could not be found.');
    }
  }

  if (selectionType && settings.strict) {
    throw new Error('Choose a valid Dyslibria typography profile.');
  }

  return resolveBuiltinPresetSelection(DEFAULT_PRESET_ID);
}

function createTypographyPreview(profile, sampleText = TYPOGRAPHY_PREVIEW_TEXT) {
  const result = applyDyslibriaProfile(sampleText, profile);

  return {
    sampleText,
    html: result.html,
    css: result.css && result.css.safe ? result.css.safe : '',
    profileUsed: result.profileUsed
  };
}

function buildTypographyProfileCatalog({ storedSelection, storedCustomProfiles, sampleText = TYPOGRAPHY_PREVIEW_TEXT }) {
  const customProfiles = normalizeStoredCustomTypographyProfiles(storedCustomProfiles);
  const activeSelection = resolveTypographySelection(storedSelection, customProfiles);
  const activeSelectionKey = `${activeSelection.type}:${activeSelection.id}`;

  const builtinProfiles = PROFILE_PRESETS.map((preset) => {
    const profile = createProfileFromPreset(preset.id);
    const selectionKey = `preset:${preset.id}`;
    const displayContent = getBuiltinPresetDisplayContent(preset.id, profile);

    return {
      id: preset.id,
      type: 'preset',
      label: displayContent.label,
      description: displayContent.description,
      isActive: selectionKey === activeSelectionKey,
      isDefaultPreset: preset.id === DEFAULT_PRESET_ID,
      isCustom: false,
      warnings: [],
      preview: createTypographyPreview(profile, sampleText)
    };
  });

  const importedProfiles = customProfiles.map((record) => {
    const selectionKey = `custom:${record.id}`;

    return {
      id: record.id,
      type: 'custom',
      label: record.label,
      description: record.description,
      isActive: selectionKey === activeSelectionKey,
      isDefaultPreset: false,
      isCustom: true,
      sourceKind: record.sourceKind,
      importedFilename: record.importedFilename,
      createdAt: record.createdAt,
      warnings: record.warnings,
      preview: createTypographyPreview(record.profile, sampleText)
    };
  });

  return {
    defaultPresetId: DEFAULT_PRESET_ID,
    sampleText,
    activeSelection: {
      type: activeSelection.type,
      id: activeSelection.id,
      label: activeSelection.label,
      description: activeSelection.description
    },
    profiles: [...builtinProfiles, ...importedProfiles]
  };
}

function resolveTypographyConversionOptions(storedSelection, storedCustomProfiles) {
  const customProfiles = normalizeStoredCustomTypographyProfiles(storedCustomProfiles);
  const activeSelection = resolveTypographySelection(storedSelection, customProfiles);

  if (activeSelection.type === 'custom') {
    return {
      type: 'custom',
      id: activeSelection.id,
      label: activeSelection.label,
      activeSelection: {
        type: 'custom',
        id: activeSelection.id,
        label: activeSelection.label
      },
      convertOptions: {
        profile: clone(activeSelection.profile)
      }
    };
  }

  return {
    type: 'preset',
    id: activeSelection.id,
    label: activeSelection.label,
    activeSelection: {
      type: 'preset',
      id: activeSelection.id,
      label: activeSelection.label
    },
    convertOptions: {
      presetId: activeSelection.id
    }
  };
}

module.exports = {
  DEFAULT_PRESET_ID,
  PROFILE_PRESETS,
  TYPOGRAPHY_PREVIEW_TEXT,
  buildTypographyProfileCatalog,
  importCustomTypographyProfile,
  normalizeStoredCustomTypographyProfiles,
  resolveTypographyConversionOptions,
  resolveTypographySelection
};
