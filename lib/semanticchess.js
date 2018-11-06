const namespaces = require('./namespaces');
const uniqid = require('uniqid');
const N3 = require('n3');
const newEngine = require('@comunica/actor-init-sparql-rdfjs').newEngine;
const auth = require('solid-auth-client');
const Chess = require('chess.js');
const Q = require('q');
const Utils = require('./utils');

class SemanticChessGame {

  /*
    @url the unique url of this chess game
    @userDataUrl the url of the current user's data file where the chess data is stored
    @userWebId the WebID of the current user
    @opponentWebId the WebID of the opponent
  */
  constructor(options) {
    this.url = options.url;
    this.userDataUrl = options.userDataUrl;
    this.userWebId = options.userWebId;
    this.opponentWebId = options.opponentWebId;
    this.chessGame = options.chessGame;
    this.name = options.name;
    this.startPosition = options.startPosition; // FEN
    this.lastMove = options.lastMove;
    this.lastUserMove = options.lastUserMove;

    if (!options.colorOfUser) {
      this.colorOfUser = 'white';
    } else {
      this.colorOfUser = options.colorOfUser;
    }

    if (!options.turn) {
      this.turn = 'white';
    } else {
      this.turn = options.turn;
    }

    if (this.name === '') {
      this.name = null;
    }

    if (this.colorOfUser === 'white') {
      this.colorOfOpponent = 'black';
    } else {
      this.colorOfOpponent = 'white';
    }

    if (!this.lastMove) {
      this.colorOfFirstTurn = this.turn;
    }
  }

  isOpponentsTurn() {
    return this.turn === this.colorOfOpponent;
  }

  addMove(san, moveUrl) {
    let result;

    if (this.turn === this.colorOfUser) {
      result = this._addUserMove(san);
      this.turn = this.colorOfOpponent;
    } else {
      result = this._addOpponentMove(san, moveUrl);
      this.turn = this.colorOfUser;
    }

    return result;
  }

  getLastMove() {
    return this.lastMove;
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

  getOpponentWebId() {
    return this.opponentWebId;
  }

  getUrl() {
    return this.url;
  }

  getUserDataUrl() {
    return this.userDataUrl;
  }

  setTurn(turn) {
    this.turn = turn;
  }

  getName() {
    return this.name;
  }

  getStartPosition() {
    return this.startPosition;
  }

  /*
    Updates the last user move and returns the corresponding RDF
  */
  _addUserMove(san) {
    //generate URL for move
    const moveURL = this.userDataUrl + `#` + uniqid();

    let sparqlUpdate = 'INSERT DATA {\n';
    let notification = null;

    sparqlUpdate +=
    `<${this.url}> <${namespaces.chess}hasHalfMove> <${moveURL}>.

    <${moveURL}> <${namespaces.rdf}type> <${namespaces.chess}HalfMove>;
      <${namespaces.chess}hasSANRecord> "${san}"^^<${namespaces.xsd}string>.\n`;

    if (this.lastMove) {
      sparqlUpdate += `<${this.lastMove.url}> <${namespaces.chess}nextHalfMove> <${moveURL}>.\n`;
      notification = `<${this.lastMove.url}> <${namespaces.chess}nextHalfMove> <${moveURL}>.`;
    } else {
      sparqlUpdate += `<${this.url}> <${namespaces.chess}hasFirstHalfMove> <${moveURL}>.\n`;
      notification = `<${this.url}> <${namespaces.chess}hasFirstHalfMove> <${moveURL}>.`;
    }

    if (this.chessGame.in_checkmate()) {
      sparqlUpdate += `<${this.url}> <${namespaces.chess}hasLastHalfMove> <${moveURL}>.\n`;
      notification += `<${this.url}> <${namespaces.chess}hasLastHalfMove> <${moveURL}>.`;
    }

    sparqlUpdate += `}`;

    this.lastMove = {
      url: moveURL,
      san
    };

    this.lastUserMove = this.lastMove;

    return {
      sparqlUpdate,
      notification
    }
  }

  _addOpponentMove(san, url) {
    this.lastMove = {url, san};

    this.chessGame.move(san);
  }

  getGameRDF() {
    if (!this.gameRDF) {
      const userAgentRole = this.userDataUrl + `#` + uniqid();
      const opponentAgentRole = this.userDataUrl + `#` + uniqid();

      this.gameRDF = `
        <${this.url}>  <${namespaces.rdf}type> <${namespaces.chess}ChessGame>;
          <${namespaces.chess}providesAgentRole> <${userAgentRole}>, <${opponentAgentRole}>.

        <${userAgentRole}> <${namespaces.rdf}type> <${namespaces.chess}WhitePlayerRole>;
          <${namespaces.chess}performedBy> <${this.userWebId}>.

        <${opponentAgentRole}> <${namespaces.rdf}type> <${namespaces.chess}BlackPlayerRole>;
          <${namespaces.chess}performedBy> <${this.opponentWebId}>.
      `;

      if (this.name) {
        this.gameRDF += `<${this.url}> <http://schema.org/name> "${this.name}".\n`;
      }

      if (this.startPosition) {
        this.gameRDF += `<${this.url}> <${namespaces.chess}startPosition> "${this.startPosition}".\n`;
      }

      if (this.colorOfFirstTurn === 'white') {
        this.gameRDF += `<${this.url}> <${namespaces.chess}starts> <${userAgentRole}>.\n`;
      } else if (this.colorOfFirstTurn === 'black') {
        this.gameRDF += `<${this.url}> <${namespaces.chess}starts> <${opponentAgentRole}>.\n`;
      }
    }

    return this.gameRDF;
  }

  /*
    Generates a hash for the current state of the chess game
  */
  _generateHash() {

  }

  static generateFromUrl(gameUrl, userWebId, userDataUrl) {
    const deferred = Q.defer();

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
              const startPosition = await Utils.getStartPositionOfGame(gameUrl);
              let chess;

              if (startPosition) {
                chess = new Chess(startPosition);
              } else {
                chess = new Chess();
              }

              const moves = await SemanticChessGame._findMove(myEngine, gameUrl, namespaces.chess + 'hasFirstHalfMove');
              //console.log(moves);

              moves.forEach(move => {
                chess.move(move.san);
              });

              let lastMove = null;

              if (moves.length > 0) {
                lastMove = moves[moves.length - 1];
              }

              //console.log(chess.ascii());
              let turn = 'white';

              if (chess.turn() === 'b') {
                turn = 'black';
              }

              const colorOfUser = await SemanticChessGame._findUserColor(myEngine, sources, userWebId);
              const oppWebId = await SemanticChessGame._findWebIdOfOpponent(myEngine, sources, userWebId);
              const name = await Utils.getGameName(gameUrl);

              const semanticGame = new SemanticChessGame({url: gameUrl, userDataUrl, userWebId, opponentWebId: oppWebId, colorOfUser, chessGame: chess, lastMove, name, startPosition, turn});
              let t = 'white';

              if (chess.turn() === 'b') {
                t = 'black';
              }

              semanticGame.setTurn(t);

              deferred.resolve(semanticGame);
            }
          });
        }
      });

    return deferred.promise;
  }

  static async _findMove(engine, current, predicate) {
    const deferred = Q.defer();
    let results = [];

    const rdfjsSource = await Utils.getRDFjsSourceFromUrl(current);
    let nextMoveFound = false;

    engine.query(`SELECT * {
      OPTIONAL { <${current}> <${namespaces.chess}hasSANRecord> ?san. }
      OPTIONAL { <${current}> <${predicate}> ?nextMove. }
    } LIMIT 100`,
      { sources: [ { type: 'rdfjsSource', value: rdfjsSource } ] })
      .then(function (result) {
        result.bindingsStream.on('data', async function (data) {
          data = data.toObject();

          if (data['?san']) {
            results.push({
              san: data['?san'].value,
              url: current
            });
          }

          if (data['?nextMove']) {
            nextMoveFound = true;
            const t = await SemanticChessGame._findMove(engine, data['?nextMove'].value, namespaces.chess + 'nextHalfMove');
            results = results.concat(t);
          }

          deferred.resolve(results);
        });

        result.bindingsStream.on('end', function () {
          if (!nextMoveFound) {
            deferred.resolve(results);
          }
        });
      });

    return deferred.promise;
  }

  static _findUserColor(engine, sources, userWebId) {
    const deferred = Q.defer();

    engine.query(`SELECT * { ?agentRole <${namespaces.rdf}type> ?playerRole;
                <${namespaces.chess}performedBy> <${userWebId}> } LIMIT 100`,
      { sources })
      .then(function (result) {
        result.bindingsStream.on('data', function (data) {
          const role = data.toObject()['?playerRole'].value;

          if (role === namespaces.chess + 'WhitePlayerRole') {
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

    engine.query(`SELECT ?id { ?agentRole <${namespaces.rdf}type> ?playerRole;
                   <${namespaces.chess}performedBy> ?id.
                MINUS {?playerRole <${namespaces.chess}performedBy> <${userWebId}> .}} LIMIT 100`,
      { sources })
      .then(function (result) {
        result.bindingsStream.on('data', function (data) {
          const id = data.toObject()['?id'].value;

          if (id !== userWebId) {
            deferred.resolve(id);
          }
        });
      });

    return deferred.promise;
  }
}

module.exports = SemanticChessGame;
