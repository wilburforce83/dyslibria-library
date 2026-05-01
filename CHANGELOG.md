# Changelog

## 1.1.3 - 2026-05-01

### Changed

- expanded the reader display controls with real paper texture assets plus much wider font-size and line-height ranges for accessibility tuning
- refreshed the built-in Dyslibria preset copy in `Settings` so the default and support presets now describe whole-word highlighting accurately
- made typography preset previews render on a neutral page-like surface and isolated each preview stylesheet so one preset can no longer visually override the others

### Fixed

- restored the reader line-height slider so it correctly overrides embedded Dyslibria EPUB styles during live reading

## 1.1.2 - 2026-04-25

### Changed

- refreshed the self-hosted library and settings chrome with the hosted Dyslibria glass treatment, including softer translucent panels, stronger top-bar and section surfaces, and more polished form controls
- kept book covers and book-card edges less bevelled than the surrounding interface so the shelf still feels crisp while the wider UI takes on the newer glass styling

## 1.1.1 - 2026-04-24

### Fixed

- added extra safe-area-aware top spacing to the reader settings overlay so installed iPhone and iPad PWAs keep the settings content comfortably below the camera slot and status area

## 1.1.0 - 2026-04-24

### Changed

- added safe-area-aware reader padding so installed iPhone and iPad PWAs keep the reading surface comfortably below the camera slot and system status area
- removed the reader's alternate reading-mode toggle so Dyslibria now stays paginated everywhere by design

## 1.0.19 - 2026-04-22

### Fixed

- deferred automatic library refreshes until the conversion queue is actually idle, so large batch uploads no longer keep flashing the "Refreshing your library" state after each completed book

## 1.0.18 - 2026-04-22

### Changed

- bumped the official Docker runtime and build images from Node 20 to Node 24 after validating install, test, build, and startup behavior on the newer base image
- updated the Docker publish workflow to force JavaScript actions onto Node 24 now, matching GitHub's recommended migration path ahead of the Node 20 runner deprecation

## 1.0.17 - 2026-04-22

### Added

- persistent on-disk session storage so production containers no longer rely on Express's in-memory `MemoryStore`
- incremental metadata cache maintenance and regression tests for single-book upserts, removals, and warm-cache reuse

### Changed

- stopped blocking server startup on a full library metadata rebuild and moved startup reconciliation into the background
- rebuilt the EPUB metadata cache flow so unchanged books keep their existing cached cover previews and metadata instead of being re-extracted on every boot, refresh, upload, or delete
- stabilized cover cache versioning per book so a normal metadata reconcile no longer invalidates every cover URL across the whole library
- enabled gzip compression on app responses and added metadata-ready headers to the library catalog endpoint for warmer startup behavior
- reworked the library browser for large shelves with memoized derived book lists, debounced search, lighter shelf collection state, and progressive infinite rendering in grid and compact views instead of mounting every card at once

## 1.0.16 - 2026-04-22

### Fixed

- stopped startup metadata refresh from embedding full-size cover images into `db/epubData.json`, which could exhaust the Node heap on larger libraries and leave the container stuck restarting
- limited fallback cover detection to a small set of likely candidates and generated compact preview covers instead, keeping boot-time library scans lightweight even for image-heavy EPUB collections

## 1.0.15 - 2026-04-22

### Changed

- upgraded the shared `dyslibria-converter` dependency to `0.3.0`
- enabled the converter's default EPUB image optimization profile for all uploaded books so self-hosted processing now uses the same aggressive-safe size reduction path by default

## 1.0.7 - 2026-04-21

### Added

- an in-modal upload progress bar for library batch uploads, including live byte progress, queue confirmation, and clear failure messaging during large multi-book uploads
- a new reader page margin slider so readers can move the text block further in from the edge of the screen and tune the page feel more like a dedicated ereader

### Changed

- kept the upload modal open and informative while files are still transferring or being validated by the server
- tuned the reader padding logic so the new page margin setting stays comfortable across phone and larger-screen layouts

## 1.0.6 - 2026-04-21

### Added

- integrated the published `dyslibria-converter@0.2.0` npm package into the self-hosted app so Docker, the hosted worker path, and local tooling now share the same EPUB conversion engine
- package-backed EPUB inspection during upload so invalid or malformed books are rejected earlier
- structured conversion step logging from the shared package into Dyslibria's existing in-app conversion logs
- loading skeletons and cached shelf rendering for faster-feeling library open and return-to-library flows
- incremental card rendering and cached cover delivery for smoother large-library performance on slower hardware
- fullscreen PWA display mode so installed Dyslibria feels more native on supported devices

### Changed

- pinned the conversion engine dependency to an exact package version for reproducible Docker and local installs
- kept failed conversions quarantined while cleaning up partial processed outputs more reliably
- updated the install and release docs to reflect the published package-backed pipeline and current image tag example

### Notes

- no storage path migration is required for this release
- Docker persistence paths remain `/usr/src/app/uploads`, `/usr/src/app/processed`, `/usr/src/app/db`, and `/usr/src/app/failed`
