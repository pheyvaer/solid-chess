# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

### [0.0.5] - 2018-11-xx

### Fixed

- new game data that is saved to an existing file does not overwrite other game data
- make sure that new game url is unused
- catch error when notification is invalid RDF

## [0.0.4] - 2018-11-10

### Fixed

- modal did not show when not logged in and clicking on "join game"

## [0.0.3] - 2018-11-10

### Added

- use [LDflex](https://github.com/solid/query-ldflex) where possible
- add opponent's name to game name in continue menu ([#27](https://github.com/pheyvaer/solid-chess/issues/27))

## [0.0.2] - 2018-11-09

### Added

- use [semantic-chess](https://github.com/pheyvaer/semantic-chess-js), which replaces the local semantic chess code

[0.0.5]: https://github.com/pheyvaer/solid-chess/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/pheyvaer/solid-chess/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/pheyvaer/solid-chess/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/pheyvaer/solid-chess/compare/v0.0.1...v0.0.2
