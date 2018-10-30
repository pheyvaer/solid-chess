const chessOnto = 'http://purl.org/NET/rdfchess/ontology/';
const xsd = 'http://www.w3.org/2001/XMLSchema#';
const rdf = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const uniqid = require('uniqid');
const N3 = require('n3');
const { DataFactory } = N3;
const { namedNode, literal, defaultGraph, quad } = DataFactory;
const newEngine = require('@comunica/actor-init-sparql-rdfjs').newEngine;
const auth = require('solid-auth-client');
const Chess = require('chess.js');
const Q = require('q');

class SemanticChessGame {

  /*
    @url the unique url of this chess game
    @userDataURL the url of the current user's data file where the chess data is stored
    @userWebId the WebID of the current user
    @opponentWebId the WebID of the opponent
  */
  constructor(url, userDataURL, userWebId, opponentWebId = null, colorOfUser = 'white', chessGame = null) {
    this.url = url;
    this.userDataURL = userDataURL;
    this.userWebId = userWebId;
    this.opponentWebId = opponentWebId;
    this.colorOfUser = colorOfUser;
    this.turn = colorOfUser;
    this.chessGame = chessGame;

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

  getChessGame() {
    return this.chessGame;
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
    const deferred = Q.defer();
    this.url = gameUrl;
    const chess = new Chess();

    auth.fetch(gameUrl)
      .then(async res => {
        if (res.status === 404) {
          deferred.reject(404);
        } else {
          const body = await res.text();
          const store = N3.Store();
          const parser = N3.Parser({baseIRI: res.url});

          console.log(body);

          parser.parse(body, async (err, quad, prefixes) => {
            if (err) {
              deferred.reject();
            } else if (quad) {
              store.addQuad(quad);
            } else {
              const source = {
                match: function(s, p, o, g) {
                  return require('streamify-array')(store.getQuads(s, p, o, g));
                }
              };
              const sources = [ { type: 'rdfjsSource', value: source } ];
              const myEngine = newEngine();

              const moves = await SemanticChessGame._findNextMove(myEngine, sources, gameUrl, chessOnto + 'hasFirstHalfMove');
              console.log(moves);

              moves.forEach(move => {
                chess.move(move);
              });

              console.log(chess.ascii());

              const colorOfUser = await SemanticChessGame._findUserColor(myEngine, sources, userWebId);
              console.log(colorOfUser);

              const oppWebId = await SemanticChessGame._findWebIdOfOpponent(myEngine, sources, userWebId);
              console.log(oppWebId);
            }
          });
        }
      });

    return deferred.promise;
  }

  static _findNextMove(engine, sources, previous, predicate) {
    const deferred = Q.defer();
    const results = [];

    engine.query(`SELECT * { <${previous}> <${predicate}> ?move.
                ?move <${chessOnto}hasSANRecord> ?san.
                 } LIMIT 100`,
      { sources })
      .then(function (result) {
        result.bindingsStream.on('data', async function (data) {
          results.push(data.toObject()['?san'].value);
          results.concat(await SemanticChessGame._findNextMove(engine, sources, data.toObject()['?move'].value, chessOnto + 'nextHalfMove'));

          deferred.resolve(results);
        });

        result.bindingsStream.on('end', function () {
          deferred.resolve(results);
        });
      });

    return deferred.promise;
  }

  static _findUserColor(engine, sources, userWebId) {
    const deferred = Q.defer();

    engine.query(`SELECT * { ?agentRole <${rdf}type> ?playerRole;
                <${chessOnto}performedBy> <${userWebId}> } LIMIT 100`,
      { sources })
      .then(function (result) {
        result.bindingsStream.on('data', function (data) {
          const role = data.toObject()['?playerRole'];

          if (role === chessOnto + 'WhitePlayerRole') {
            deferred.resolve('white');
          } else {
            deferred.resolve('black');
          }
        });
      });

    return deferred.promise;
  }

  static _findWebIdOfOpponent(engine, sources, userWebId) {
    const deferred = Q.defer();

    engine.query(`SELECT * { ?agentRole <${rdf}type> ?playerRole;
                <${chessOnto}performedBy> <${userWebId}> } LIMIT 100`,
      { sources })
      .then(function (result) {
        result.bindingsStream.on('data', function (data) {
          deferred.resolve('test');
        });
      });

    return deferred.promise;
  }
}

module.exports = SemanticChessGame;
