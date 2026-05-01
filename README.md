# Dyslibria

Dyslibria is an open source, self-hosted EPUB library for people who want reading to feel calmer, clearer, and easier to come back to.

It combines three things in one container:

- an upload and conversion pipeline for EPUB files
- a browser reading app with saved reading progress
- OPDS and WebDAV access for external readers and library tools

The conversion engine is now provided by the published `dyslibria-converter` npm package so the self-hosted app, CLI, and future hosted workers share the same EPUB processing behavior.

You can run it on a home server, NAS, VPS, mini PC, or a small classroom/community setup. The aim is simple: keep your books, your reading progress, and your access under your control.

## What Dyslibria Includes

- EPUB upload and processing
- self-hosted browser reader for desktop, tablet, and phone
- server-side saved reading position so books reopen where you left off
- OPDS feed for compatible reading apps
- WebDAV access to the processed library
- quarantine for failed conversions instead of silently publishing broken files
- Docker-first deployment with persistent storage

## Dyslibria Typography Profiles

Administrator accounts can now choose the Dyslibria typography profile used for new EPUB conversions.

From `Settings`, you can:

- choose from the built-in Dyslibria presets
- preview each preset against a shared sample text
- import custom profile JSON files
- import full Dyslibria reader-configuration JSON files
- select which profile future uploads should use

Custom profiles are stored in the server database and appear alongside the built-in presets in the same list.

## Quick Start With Docker Compose

The included Compose file pulls the published image from Docker Hub:

- `wilburforce83/dyslibria:latest`

Start it with:

```bash
git clone https://github.com/wilburforce83/bionic-epub-convertor.git
cd bionic-epub-convertor
docker compose pull
docker compose up -d
```

Then open:

- Web app: `http://localhost:3000`
- OPDS feed: `http://localhost:3000/opds`
- WebDAV: `http://localhost:1900`

## First Login

On a fresh install, sign in with:

- username: `admin`
- password: `dyslibria`

Dyslibria will then prompt you to create the permanent administrator account. After that bootstrap step, the default login stops working.

## Persistent Storage

The default `docker-compose.yml` persists these paths:

- `/usr/src/app/uploads`
- `/usr/src/app/processed`
- `/usr/src/app/db`
- `/usr/src/app/failed`

That means your settings, uploaded files, processed library, and reading progress survive image updates.

## Updating Dyslibria

If you are running the included Compose setup:

```bash
docker compose pull
docker compose up -d
```

If you want to pin a release instead of tracking `latest`, set:

```env
IMAGE_TAG=1.0.7
```

and then run:

```bash
docker compose pull
docker compose up -d
```

## Health Check

Dyslibria exposes:

- `GET /healthz`

It reports whether the app is up, whether processing is active, whether anything is queued, and whether metadata is ready.

## Documentation

- [Install guide](docs/INSTALL.md)
- [Usage guide](docs/USAGE.md)
- [Release guide](docs/RELEASE.md)

## Local Development

If you want to run from source instead of Docker, see the source install section in [docs/INSTALL.md](docs/INSTALL.md).

## Docker Hub

Published images live at:

- `https://hub.docker.com/r/wilburforce83/dyslibria`

## License

This project is licensed under the MIT License.
