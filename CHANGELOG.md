# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/)
and this project adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2018-12-20

### Added 

- Initial support for real-time games using WebRTC (only in the browser)
- Screencast of real-time game
- Credits for Font Awesome icon that is used for background

### Fixed

- Typo on index page

## [0.1.1] - 2018-12-08

### Added

- add `core.js` and `datasync.js` to root `index.js`

## [0.1.0] - 2018-12-08

### Added

- CLI to play the chess game
- add CLI documentation to README and index
- `core.js` to replace `utils.js`

### Fixed

- clean up DataSync
- fix that log-in button still shown after logging in

### Removed

- `utils.js` replaced by `core.js`

## [0.0.7] - 2018-11-24

### Added

- add documentation in the code
- configure JSDoc: documentation is available in `docs`
- use [schema:InviteAction](http://schema.org/InviteAction) to represent an invitation to join a chess game
- use [schema:RsvpAction](http://schema.org/RsvpAction) to represent an response to invitation
- use [schema:contributor](http://schema.org/contributor) to add the games of user to his WebId
- send acceptance of invitation when joining a game
- show modal when response to invitation is received
- show games to continue in table
- update background
- add basic RDFa

### Fixed

- fix capitalization in some methods in `index.js`

## [0.0.6] - 2018-11-12

### Added

- show modal when you do not have write permission for file

### Fixed

- generating new game url failed when file did not exist

## [0.0.5] - 2018-11-12

### Fixed

- new game data that is saved to an existing file does not overwrite other game data
- make sure that new game url is unused
- catch error when notification is invalid RDF
- fix duplicate ids in HTML
- add option to switch between themes (pieces and board)
- add "modern" theme
- make board responsive
- add document that discusses the interaction between Solid Chess and the different PODs

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

[0.2.0]: https://github.com/pheyvaer/solid-chess/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/pheyvaer/solid-chess/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/pheyvaer/solid-chess/compare/v0.0.7...v0.1.0
[0.0.7]: https://github.com/pheyvaer/solid-chess/compare/v0.0.6...v0.0.7
[0.0.6]: https://github.com/pheyvaer/solid-chess/compare/v0.0.5...v0.0.6
[0.0.5]: https://github.com/pheyvaer/solid-chess/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/pheyvaer/solid-chess/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/pheyvaer/solid-chess/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/pheyvaer/solid-chess/compare/v0.0.1...v0.0.2
