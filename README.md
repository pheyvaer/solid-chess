# Solid Chess

This is a decentralized Chess app, build on top of [Solid](https://solid.inrupt.com/).
No central sever is required to run or set up a game.
All personal data about the game is stored on your POD.
Requests to join and updates of a game are sent to the inbox of your opponent directly.

Check the [live version](https://pheyvaer.github.io/solid-chess/) or the [screencast](https://streamable.com/tf8yv).

WARNING: The "Clear inbox" button **removes all files with (chess) game data** in your inbox! So be careful!

## Documentation

- Code documentation can be found [here](https://pheyvaer.github.io/solid-chess/docs/).
- If you want to know more about how the application interacts with different Solid PODs, you can read [this](./interaction-with-pods.md).

## What you can do
- Create a new game, which will send a request to join to your opponent.
- Join a game
- Continue a game you started earlier

## Used technologies/concepts/libraries
- [Linked Data](https://en.wikipedia.org/wiki/Linked_data): to represent/share the details of the games
- [Decentralization](https://en.wikipedia.org/wiki/Decentralization#Information_technology): information is fetched from different servers
- [Solid PODs](https://solid.inrupt.com/get-a-solid-pod): store personal data about the games
- [LDflex for Solid](https://github.com/solid/query-ldflex): simple access to data in Solid pods through LDflex expressions
- [SPARQL](https://www.w3.org/TR/2013/REC-sparql11-overview-20130321/): query/update games
- [RDF](https://www.w3.org/TR/rdf11-concepts/): representation of the data
- [Comunica](https://github.com/comunica/): querying different data sources
- [chess.js](https://github.com/jhlywa/chess.js): chess engine
- [chessboard.js](https://github.com/oakmac/chessboardjs/): chessboard

## Install

You can run the game locally by doing the following:
- Clone this repo.
- `npm i`: install Node.js dependencies.
- `npm run build`: bundle the JavaScript via Webpack. The result can be found in `dist/main.js`.
- Serve the contents of the folder, e.g., via `http-server`.

## Credits

[Freevector Chess Pieces Set](https://www.freevector.com/chess-pieces-set) ([CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), no changes were made)

## License
© 2018 [Pieter Heyvaert](https://pieterheyvaert.com), [MIT License](https://github.com/pheyvaer/solid-chess/blob/master/LICENSE.md)
