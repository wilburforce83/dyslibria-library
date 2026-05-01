const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('fs-extra');
const AdmZip = require('adm-zip');
const sharp = require('sharp');
const { convertBook, resolveZipEntryPath } = require('dyslibria-converter');

const {
  extractEpubData,
  upsertEpubMetadataForFile,
  removeEpubMetadataForFile,
  getEpubs
} = require('../utils/epubDataUtils');
const {
  deleteLibraryBookFiles,
  listLibraryBookFilenames,
  removeReadingProgressForUserAndFilename
} = require('../utils/libraryMaintenance');
const { createMinimalEpub } = require('./helpers/epubTestUtils');

async function makeTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function convertFixtureEpub(epubOptions = {}, convertOptions = {}) {
  const tempDir = await makeTempDir('dyslibria-convert-');
  const inputPath = path.join(tempDir, 'input.epub');
  const outputPath = path.join(tempDir, 'output.epub');
  const workspaceRoot = path.join(tempDir, 'workspace');

  await createMinimalEpub(inputPath, epubOptions);
  await fs.ensureDir(workspaceRoot);
  const result = await convertBook(inputPath, {
    outputPath,
    returnBuffer: false,
    tempRootDir: workspaceRoot,
    ...convertOptions
  });

  return {
    tempDir,
    inputPath,
    outputPath,
    result
  };
}

const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+lmVsAAAAASUVORK5CYII=';

function parseDataUriAsset(dataUri) {
  const match = /^data:([^;]+);base64,(.+)$/u.exec(String(dataUri || ''));

  assert.ok(match, 'Expected a base64 data URI');

  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], 'base64')
  };
}

async function createLargeJpegBase64(width = 1800, height = 2600) {
  const rawBuffer = Buffer.alloc(width * height * 3);

  for (let index = 0; index < rawBuffer.length; index += 1) {
    rawBuffer[index] = (index * 31 + 17) % 256;
  }

  const jpegBuffer = await sharp(rawBuffer, {
    raw: {
      width,
      height,
      channels: 3
    }
  }).jpeg({
    quality: 92,
    mozjpeg: true
  }).toBuffer();

  return jpegBuffer.toString('base64');
}

test('resolveZipEntryPath rejects zip-slip style archive entries', async () => {
  const tempDir = await makeTempDir('dyslibria-zip-slip-');
  const outputPath = path.join(tempDir, 'extracted');

  await assert.throws(
    () => resolveZipEntryPath(outputPath, '../escape.txt'),
    /Unsafe archive entry path|escapes extraction directory/
  );
  assert.equal(await fs.pathExists(path.join(tempDir, 'escape.txt')), false);
});

test('convertBook transforms readable text but leaves preformatted blocks alone', async () => {
  const { outputPath, result } = await convertFixtureEpub({
    chapterMarkup: `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body>
    <p>This smoke test should be converted.</p>
    <pre>Literal sample text</pre>
  </body>
</html>`
  });

  const content = new AdmZip(outputPath).readAsText('OEBPS/chapter1.xhtml');

  assert.ok(result.outputPath);
  assert.equal(result.stats.processedFiles, 1);
  assert.match(content, /dyslibria-engine/);
  assert.match(content, /dyslibria-paragraph/);
  assert.match(content, /dyslibria-word--emphasised/);
  assert.match(content, /<pre>Literal sample text<\/pre>/);
  assert.doesNotMatch(content, /<pre>.*dyslibria-word/s);
});

test('convertBook escapes stray ampersands without double-escaping valid entities', async () => {
  const { outputPath, result } = await convertFixtureEpub({
    chapterMarkup: `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body>
    <p>AT&T and Tom &amp; Jerry & Blues</p>
    <pre>R&D && Co.</pre>
  </body>
</html>`
  });

  const content = new AdmZip(outputPath).readAsText('OEBPS/chapter1.xhtml');

  assert.equal(result.stats.processedFiles, 1);
  assert.match(content, /AT&amp;T/);
  assert.match(content, /Tom &amp;/);
  assert.match(content, /&amp; Blues/);
  assert.match(content, /<pre>R&amp;D &amp;&amp; Co\.<\/pre>/);
  assert.doesNotMatch(content, /&amp;amp;/);
});

test('convertBook can handle XHTML fragments without a body wrapper', async () => {
  const { outputPath, result } = await convertFixtureEpub({
    chapterMarkup: '<p>Loose fragment text only.</p>'
  });
  const content = new AdmZip(outputPath).readAsText('OEBPS/chapter1.xhtml');

  assert.equal(result.stats.processedFiles, 1);
  assert.match(content, /dyslibria-engine/);
  assert.match(content, /dyslibria-paragraph/);
  assert.match(content, /fragment/);
});

test('convertBook writes EPUB entry paths using forward slashes', async () => {
  const { outputPath, result } = await convertFixtureEpub();
  const entryNames = new AdmZip(outputPath).getEntries().map((entry) => entry.entryName);

  assert.equal(result.outputPath, outputPath);
  assert.ok(entryNames.includes('OEBPS/chapter1.xhtml'));
  assert.equal(entryNames.some((entryName) => entryName.includes('\\')), false);
});

test('extractEpubData keeps invalid files on disk and filters them from normal listings', async (t) => {
  t.mock.method(console, 'error', () => {});

  const tempDir = await makeTempDir('dyslibria-metadata-');
  const processedDir = path.join(tempDir, 'processed');
  const cachePath = path.join(tempDir, 'db', 'epubData.json');

  await fs.ensureDir(processedDir);
  await createMinimalEpub(path.join(processedDir, 'VALID.EPUB'), {
    title: 'Valid Book',
    author: 'Codex'
  });
  await fs.writeFile(path.join(processedDir, 'broken.epub'), 'definitely not an epub');

  await extractEpubData(processedDir, { cachePath });

  const visibleBooks = await getEpubs({ cachePath });
  const allBooks = await getEpubs({ cachePath, includeInvalid: true });
  const brokenBook = allBooks.find((book) => book.filename === 'broken.epub');

  assert.equal(await fs.pathExists(path.join(processedDir, 'broken.epub')), true);
  assert.deepEqual(
    visibleBooks.map((book) => book.filename).sort(),
    ['VALID.EPUB']
  );
  assert.equal(allBooks.length, 2);
  assert.ok(brokenBook);
  assert.equal(brokenBook.isValid, false);
  assert.ok(brokenBook.processingError);
});

test('extractEpubData keeps an explicit cover image when the EPUB declares one in OPF metadata', async () => {
  const tempDir = await makeTempDir('dyslibria-cover-');
  const processedDir = path.join(tempDir, 'processed');
  const cachePath = path.join(tempDir, 'db', 'epubData.json');

  await fs.ensureDir(processedDir);
  await createMinimalEpub(path.join(processedDir, 'with-cover.epub'), {
    title: 'Cover Book',
    author: 'Codex',
    coverFileName: 'images/cover.png',
    coverImageBase64: tinyPngBase64
  });

  await extractEpubData(processedDir, { cachePath });

  const books = await getEpubs({ cachePath });

  assert.equal(books.length, 1);
  assert.equal(books[0].title, 'Cover Book');
  assert.equal(books[0].author, 'Codex');
  assert.ok(Date.parse(books[0].metadataRefreshedAt));
  assert.match(books[0].cover, /^data:image\/png;base64,/);
});

test('extractEpubData does not replace an explicit cover with a larger fallback image', async () => {
  const tempDir = await makeTempDir('dyslibria-cover-priority-');
  const processedDir = path.join(tempDir, 'processed');
  const cachePath = path.join(tempDir, 'db', 'epubData.json');
  const largeIllustrationSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="2400" viewBox="0 0 1600 2400">
  <rect width="1600" height="2400" fill="#214f84"/>
  <circle cx="800" cy="900" r="420" fill="#f4d35e"/>
  <rect x="320" y="1500" width="960" height="380" rx="48" fill="#ffffff"/>
  <text x="800" y="1710" text-anchor="middle" font-size="144" font-family="Georgia">Frontispiece</text>
</svg>`;

  await fs.ensureDir(processedDir);
  await createMinimalEpub(path.join(processedDir, 'cover-priority.epub'), {
    title: 'Priority Cover',
    author: 'Codex',
    coverFileName: 'images/cover.png',
    coverImageBase64: tinyPngBase64,
    extraFiles: [
      {
        fileName: 'images/frontispiece.svg',
        content: largeIllustrationSvg
      }
    ]
  });

  await extractEpubData(processedDir, { cachePath });

  const books = await getEpubs({ cachePath });

  assert.equal(books.length, 1);
  assert.match(books[0].cover, /^data:image\/png;base64,/);
  assert.ok(!books[0].cover.includes('PHN2Zy'));
});

test('extractEpubData stores compact preview covers for large explicit cover images', async () => {
  const tempDir = await makeTempDir('dyslibria-cover-preview-');
  const processedDir = path.join(tempDir, 'processed');
  const cachePath = path.join(tempDir, 'db', 'epubData.json');
  const largeCoverBase64 = await createLargeJpegBase64();
  const sourceCoverBuffer = Buffer.from(largeCoverBase64, 'base64');

  await fs.ensureDir(processedDir);
  await createMinimalEpub(path.join(processedDir, 'large-cover.epub'), {
    title: 'Large Cover',
    author: 'Codex',
    coverFileName: 'images/cover.jpg',
    coverImageBase64: largeCoverBase64
  });

  await extractEpubData(processedDir, { cachePath });

  const books = await getEpubs({ cachePath });
  const previewAsset = parseDataUriAsset(books[0].cover);
  const previewMetadata = await sharp(previewAsset.buffer).metadata();

  assert.equal(books.length, 1);
  assert.equal(previewAsset.mimeType, 'image/jpeg');
  assert.ok(previewAsset.buffer.length < sourceCoverBuffer.length);
  assert.ok(previewMetadata.width <= 320);
  assert.ok(previewMetadata.height <= 480);
});

test('extractEpubData reuses the cached metadata file when EPUB files are unchanged', async () => {
  const tempDir = await makeTempDir('dyslibria-metadata-cache-hit-');
  const processedDir = path.join(tempDir, 'processed');
  const cachePath = path.join(tempDir, 'db', 'epubData.json');

  await fs.ensureDir(processedDir);
  await createMinimalEpub(path.join(processedDir, 'cache-hit.epub'), {
    title: 'Cache Hit',
    author: 'Codex',
    coverFileName: 'images/cover.png',
    coverImageBase64: tinyPngBase64
  });

  const firstEntries = await extractEpubData(processedDir, { cachePath });
  const firstStat = await fs.stat(cachePath);

  await new Promise((resolve) => setTimeout(resolve, 30));

  const secondEntries = await extractEpubData(processedDir, { cachePath });
  const secondStat = await fs.stat(cachePath);

  assert.deepEqual(secondEntries, firstEntries);
  assert.equal(secondStat.mtimeMs, firstStat.mtimeMs);
});

test('upsertEpubMetadataForFile refreshes only the changed cached EPUB entry', async () => {
  const tempDir = await makeTempDir('dyslibria-metadata-upsert-');
  const processedDir = path.join(tempDir, 'processed');
  const cachePath = path.join(tempDir, 'db', 'epubData.json');

  await fs.ensureDir(processedDir);
  await createMinimalEpub(path.join(processedDir, 'alpha.epub'), {
    title: 'Alpha',
    author: 'Codex',
    coverFileName: 'images/cover.png',
    coverImageBase64: tinyPngBase64
  });
  await createMinimalEpub(path.join(processedDir, 'beta.epub'), {
    title: 'Beta',
    author: 'Codex',
    coverFileName: 'images/cover.png',
    coverImageBase64: tinyPngBase64
  });

  await extractEpubData(processedDir, { cachePath });
  const beforeBooks = await getEpubs({ cachePath, includeInvalid: true });
  const beforeAlpha = beforeBooks.find((book) => book.filename === 'alpha.epub');
  const beforeBeta = beforeBooks.find((book) => book.filename === 'beta.epub');

  await new Promise((resolve) => setTimeout(resolve, 30));

  await createMinimalEpub(path.join(processedDir, 'alpha.epub'), {
    title: 'Alpha Updated',
    author: 'Codex',
    chapterText: 'Updated chapter text.',
    coverFileName: 'images/cover.png',
    coverImageBase64: tinyPngBase64
  });

  const updatedAlpha = await upsertEpubMetadataForFile(processedDir, 'alpha.epub', { cachePath });
  const afterBooks = await getEpubs({ cachePath, includeInvalid: true });
  const afterAlpha = afterBooks.find((book) => book.filename === 'alpha.epub');
  const afterBeta = afterBooks.find((book) => book.filename === 'beta.epub');

  assert.equal(updatedAlpha.title, 'Alpha Updated');
  assert.equal(afterAlpha.title, 'Alpha Updated');
  assert.notEqual(afterAlpha.coverVersion, beforeAlpha.coverVersion);
  assert.equal(afterBeta.coverVersion, beforeBeta.coverVersion);
  assert.equal(afterBeta.metadataRefreshedAt, beforeBeta.metadataRefreshedAt);
});

test('removeEpubMetadataForFile removes one cached EPUB without rewriting the rest of the library', async () => {
  const tempDir = await makeTempDir('dyslibria-metadata-remove-');
  const processedDir = path.join(tempDir, 'processed');
  const cachePath = path.join(tempDir, 'db', 'epubData.json');

  await fs.ensureDir(processedDir);
  await createMinimalEpub(path.join(processedDir, 'remove-me.epub'), {
    title: 'Remove Me',
    author: 'Codex'
  });
  await createMinimalEpub(path.join(processedDir, 'keep-me.epub'), {
    title: 'Keep Me',
    author: 'Codex'
  });

  await extractEpubData(processedDir, { cachePath });
  const removed = await removeEpubMetadataForFile('remove-me.epub', { cachePath });
  const remainingBooks = await getEpubs({ cachePath, includeInvalid: true });

  assert.equal(removed, true);
  assert.deepEqual(
    remainingBooks.map((book) => book.filename),
    ['keep-me.epub']
  );
});

test('libraryMaintenance lists and deletes only EPUB library files', async () => {
  const tempDir = await makeTempDir('dyslibria-library-delete-');
  const processedDir = path.join(tempDir, 'processed');

  await fs.ensureDir(processedDir);
  await createMinimalEpub(path.join(processedDir, 'keep.epub'));
  await createMinimalEpub(path.join(processedDir, 'remove.epub'));
  await fs.writeFile(path.join(processedDir, 'notes.txt'), 'not a book');

  const filenames = await listLibraryBookFilenames(processedDir);
  const deletedFilenames = await deleteLibraryBookFiles(processedDir, ['remove.epub', 'notes.txt']);

  assert.deepEqual(filenames, ['keep.epub', 'remove.epub']);
  assert.deepEqual(deletedFilenames, ['remove.epub']);
  assert.equal(await fs.pathExists(path.join(processedDir, 'keep.epub')), true);
  assert.equal(await fs.pathExists(path.join(processedDir, 'remove.epub')), false);
  assert.equal(await fs.pathExists(path.join(processedDir, 'notes.txt')), true);
});

test('libraryMaintenance removes both current and legacy reading progress keys for one user and filename', () => {
  const entries = {
    'user-1::book.epub': {
      filename: 'book.epub',
      userId: 'user-1',
      username: 'reader-one'
    },
    'reader-one::book.epub': {
      filename: 'book.epub',
      userId: 'reader-one',
      username: 'reader-one'
    },
    'user-1::other.epub': {
      filename: 'other.epub',
      userId: 'user-1',
      username: 'reader-one'
    },
    'user-2::book.epub': {
      filename: 'book.epub',
      userId: 'user-2',
      username: 'reader-two'
    }
  };

  const result = removeReadingProgressForUserAndFilename(entries, {
    id: 'user-1',
    username: 'reader-one'
  }, 'book.epub');

  assert.equal(result.removedCount, 2);
  assert.deepEqual(Object.keys(result.nextEntries).sort(), ['user-1::other.epub', 'user-2::book.epub']);
});
