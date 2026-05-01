const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_PRESET_ID,
  buildTypographyProfileCatalog,
  importCustomTypographyProfile,
  normalizeStoredCustomTypographyProfiles,
  resolveTypographyConversionOptions,
  resolveTypographySelection
} = require('../utils/typographyProfiles');

test('buildTypographyProfileCatalog falls back to the Dyslibria default preset', () => {
  const catalog = buildTypographyProfileCatalog({
    storedSelection: null,
    storedCustomProfiles: []
  });

  assert.equal(catalog.defaultPresetId, DEFAULT_PRESET_ID);
  assert.equal(catalog.activeSelection.type, 'preset');
  assert.equal(catalog.activeSelection.id, DEFAULT_PRESET_ID);
  assert.ok(catalog.profiles.some((profile) => profile.id === DEFAULT_PRESET_ID));
  assert.ok(catalog.profiles.every((profile) => profile.preview && profile.preview.html));
});

test('buildTypographyProfileCatalog uses reader-facing copy for built-in preset descriptions', () => {
  const catalog = buildTypographyProfileCatalog({
    storedSelection: { type: 'preset', id: DEFAULT_PRESET_ID },
    storedCustomProfiles: []
  });

  const defaultPreset = catalog.profiles.find((profile) => profile.id === DEFAULT_PRESET_ID);
  const frontLoadPreset = catalog.profiles.find((profile) => profile.id === 'front-load-emphasis');

  assert.ok(defaultPreset);
  assert.equal(defaultPreset.label, 'Dyslibria Default');
  assert.match(defaultPreset.description, /whole-word highlighting/i);
  assert.doesNotMatch(defaultPreset.description, /front-loaded scaffolding/i);

  assert.ok(frontLoadPreset);
  assert.match(frontLoadPreset.description, /highlights the start of each word instead of the whole word/i);
});

test('importCustomTypographyProfile accepts reader configuration wrappers and normalizes them', () => {
  const imported = importCustomTypographyProfile({
    label: '',
    filename: 'reader-config.json',
    profileJson: JSON.stringify({
      kind: 'dyslibria-reader-configuration',
      readerLabel: 'Casey',
      profile: {
        name: 'Casey focus profile',
        emphasisDensity: 0.11,
        outputCompatibilityMode: 'standardEpub'
      }
    })
  });

  assert.match(imported.id, /^custom-/);
  assert.equal(imported.label, 'reader-config');
  assert.equal(imported.sourceKind, 'reader-configuration');
  assert.equal(imported.profile.output.epubMode, 'standard-epub');
});

test('resolveTypographySelection and conversion options use custom imports when selected', () => {
  const storedProfiles = normalizeStoredCustomTypographyProfiles([
    {
      id: 'custom-example',
      label: 'Gentle import',
      profile: {
        name: 'Gentle import',
        emphasisDensity: 0.09,
        outputCompatibilityMode: 'standardEpub'
      }
    }
  ]);

  const activeSelection = resolveTypographySelection({
    type: 'custom',
    id: 'custom-example'
  }, storedProfiles, {
    strict: true
  });
  const conversion = resolveTypographyConversionOptions({
    type: 'custom',
    id: 'custom-example'
  }, storedProfiles);

  assert.equal(activeSelection.type, 'custom');
  assert.equal(activeSelection.id, 'custom-example');
  assert.equal(conversion.label, 'Gentle import');
  assert.equal(conversion.activeSelection.label, 'Gentle import');
  assert.ok(conversion.convertOptions.profile);
  assert.equal(conversion.convertOptions.profile.emphasisDensity, 0.09);
});
