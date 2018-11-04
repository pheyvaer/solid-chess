# Solid Chess

This is a decentralized Chess app, build on top of [Solid](https://solid.inrupt.com/).
No central sever is required to run or set up a game.
All personal data about the game is stored on your POD.
Requests to join and updates of a game are sent to the inbox of your opponent directly.

Check the live version or the screencast.

WARNING: The "Clear inbox" button **removes all files** in your inbox! So be careful!

## What you can do
- Create a new game, which will send a request to join to your opponent.
- Join a game
- Continue a game you started earlier

## Used technologies/concepts
- [Linked Data](https://en.wikipedia.org/wiki/Linked_data): to represent/share the details of the games
- [Decentralization](https://en.wikipedia.org/wiki/Decentralization#Information_technology): information is fetched from different servers
- [Solid PODs](https://solid.inrupt.com/get-a-solid-pod): store personal data about the games
- [SPARQL](https://www.w3.org/TR/2013/REC-sparql11-overview-20130321/): query/update games
- [RDF](https://www.w3.org/TR/rdf11-concepts/): representation of the data
- [Comunica](https://github.com/comunica/): querying different data sources

## License
© 2018 [Pieter Heyvaert](https://pieterheyvaert.com), [MIT License](https://github.com/pheyvaer/solid-chess/blob/master/LICENSE.md)
