const chessOnto = 'http://purl.org/NET/rdfchess/ontology/';
const xsd = 'http://www.w3.org/2001/XMLSchema#';
const rdf = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const uniqid = require('uniqid');
const N3 = require('n3');
const { DataFactory } = N3;
const { namedNode, literal, defaultGraph, quad } = DataFactory;
const newEngine = require('@comunica/actor-init-sparql-rdfjs').newEngine;
const auth = require('solid-auth-client');

class SemanticChessGame {

  /*
    @url the unique url of this chess game
    @userDataURL the url of the current user's data file where the chess data is stored
    @userWebId the WebID of the current user
    @opponentWebId the WebID of the opponent
  */
  constructor(url, userDataURL, userWebId, opponentWebId = null, colorOfUser = 'white') {
    this.url = url;
    this.userDataURL = userDataURL;
    this.userWebId = userWebId;
    this.opponentWebId = opponentWebId;
    this.colorOfUser = colorOfUser;
    this.turn = colorOfUser;

    if (this.colorOfUser === 'white') {
      this.colorOfOpponent = 'black';
    } else {
      this.colorOfOpponent = 'white';
    }

    this.lastMove = null;
    this.lastUserMove = null;
  }

  addMove(san) {
    let sparqlQuery;

    if (this.turn === this.colorOfUser) {
      sparqlQuery = this._addUserMove(san);
      this.turn = 'black';
    } else {
      sparqlQuery = this._addOpponentMove(san);
      this.turn = 'white';
    }

    return sparqlQuery;
  }

  getLastUserMove() {
    return this.lastUserMove;
  }

  getUserColor() {
    return this.colorOfUser;
  }

  getOpponentColor() {
    return this.colorOfOpponent;
  }

  /*
    Updates the last user move and returns the corresponding RDF
  */
  _addUserMove(san) {
    //generate URL for move
    const moveURL = this.userDataURL + `#` + uniqid();

    let sparqlUpdate = 'INSERT DATA {\n';

    sparqlUpdate +=
    `<${this.url}> <${chessOnto}hasHalfMove> <${moveURL}>.

    <${moveURL}> <${rdf}type> <${chessOnto}HalfMove>;
      <${chessOnto}hasSANRecord> "${san}"^^<${xsd}string>.\n`;

    if (this.lastMove) {
      sparqlUpdate += `<${this.lastMove.url}> <${chessOnto}nextHalfMove> <${moveURL}>.\n`;
    } else {
      sparqlUpdate += `<${this.url}> <${chessOnto}hasFirstHalfMove> <${moveURL}>.\n`;
    }

    sparqlUpdate += `}`;

    this.lastMove = {
      url: moveURL,
      san
    };

    this.lastUserMove = this.lastMove;

    return sparqlUpdate;
  }

  _addOpponentMove(moveUrl, san) {

  }

  getGameRDF() {
    if (!this.gameRDF) {
      const userAgentRole = this.userDataURL + `#` + uniqid();
      const opponentAgentRole = this.userDataURL + `#` + uniqid();

      this.gameRDF = `
        <${this.url}>  <${rdf}type> <${chessOnto}ChessGame>;
          <${chessOnto}providesAgentRole> <${userAgentRole}>, <${opponentAgentRole}>.

        <${userAgentRole}> <${rdf}type> <${chessOnto}WhitePlayerRole>;
          <${chessOnto}performedBy> <${this.userWebId}>.

        <${opponentAgentRole}> <${rdf}type> <${chessOnto}BlackPlayerRole>;
          <${chessOnto}performedBy> <${this.opponentWebId}>.
      `;
    }

    return this.gameRDF;
  }

  /*
    Generates a hash for the current state of the chess game
  */
  _generateHash() {

  }

  static generateFromUrl(gameUrl, userWebId) {
    this.url = gameUrl;
    auth.fetch(gameUrl)
      .then(async res => {
        if (res.status === 404) {
          deferred.reject(404);
        } else {
          const body = await res.text();
          const store = N3.Store();
          const parser = N3.Parser();

          console.log(body);

          parser.parse(body, (err, quad, prefixes) => {
            if (err) {
              deferred.reject();
            } else if (quad) {
              store.addQuad(quad);
            } else {
              const firstHalfMoves = store.getQuads(namedNode(gameUrl), namedNode(chessOnto + 'hasFirstHalfMove'), null).map(a => a.object);

              if (firstHalfMoves.length > 0) {
                console.log(firstHalfMoves);
              }

              const source = {
                match: function(s, p, o, g) {
                  return require('streamify-array')(store.getQuads(s, p, o, g));
                }
              };

              // Create our engine, and query it.
              // If you intend to query multiple times, be sure to cache your engine for optimal performance.
              const myEngine = newEngine();
              myEngine.query(`SELECT * { ?agentRole <${rdf}type> ?playerRole;
                <${chessOnto}performedBy> <${userWebId}> } LIMIT 100`,
                { sources: [ { type: 'rdfjsSource', value: source } ] })
                .then(function (result) {
                  result.bindingsStream.on('data', function (data) {
                    // Each data object contains a mapping from variables to RDFJS terms.
                    console.log(data);
                  });
                });
            }
          });
        }
      });
  }
}

module.exports = SemanticChessGame;
