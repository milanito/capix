# Changelog

All notable changes to `@capixjs/plugin-helmet` are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning: [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- `mergeHooks()` now carries the `cors` field through from whichever argument defines it. Previously it merged only `hooks`, so `restTransport({ ...mergeHooks(cors(...), helmet()) })` silently dropped the CORS origin restriction and fell back to the transport's default (`origin: '*'`) while Helmet's headers still applied.

## [0.1.0] - 2026-05-25

### Added
- Initial release. Security headers plugin (CSP, X-Frame-Options, X-Content-Type-Options).
