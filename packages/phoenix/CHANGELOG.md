# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Runtime tools are published over a private Unix domain socket at app boot.

### Changed

- The runtime protocol identifies a project by the project key derived from its
  canonical path, on both transports.
- The endpoint Plug is now the alternative transport; the socket is the default.
