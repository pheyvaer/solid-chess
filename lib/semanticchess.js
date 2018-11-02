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
const ldfetch = require('ldfetch');
const Utils = require('./utils');

class SemanticChessGame {

  /*
    @url the unique url of this chess game
    @userDataURL the url of the current user's data file where the chess data is stored
    @userWebId the WebID of the current user
    @opponentWebId the WebID of the opponent
  */
  constructor(url, userDataURL, userWebId, opponentWebId = null, colorOfUser = 'white', chessGame = null, lastMove = null, lastUserMove = null) {
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

    this.lastMove = lastMove;
    this.lastUserMove = lastUserMove;
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
    return this.userDataURL;
  }

  /*
    Updates the last user move and returns the corresponding RDF
  */
  _addUserMove(san) {
    //generate URL for move
    const moveURL = this.userDataURL + `#` + uniqid();

    let sparqlUpdate = 'INSERT DATA {\n';
    let notification = null;

    sparqlUpdate +=
    `<${this.url}> <${chessOnto}hasHalfMove> <${moveURL}>.

    <${moveURL}> <${rdf}type> <${chessOnto}HalfMove>;
      <${chessOnto}hasSANRecord> "${san}"^^<${xsd}string>.\n`;

    if (this.lastMove) {
      sparqlUpdate += `<${this.lastMove.url}> <${chessOnto}nextHalfMove> <${moveURL}>.\n`;
      notification = `<${this.lastMove.url}> <${chessOnto}nextHalfMove> <${moveURL}>.`;
    } else {
      sparqlUpdate += `<${this.url}> <${chessOnto}hasFirstHalfMove> <${moveURL}>.\n`;
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

  _addOpponentMove(san, moveUrl) {
    this.lastMove.url = moveUrl;
    this.lastMove.san = san;

    this.chessGame.move(san);
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

  static generateFromUrl(gameUrl, userWebId, userDataUrl) {
    const deferred = Q.defer();
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
              const fetch = new ldfetch({});

              const moves = await SemanticChessGame._findMove(myEngine, fetch, gameUrl, chessOnto + 'hasFirstHalfMove');
              console.log(moves);

              moves.forEach(move => {
                chess.move(move.san);
              });

              let lastMove = null;

              if (moves.length > 0) {
                lastMove = moves[moves.length - 1];
              }

              console.log(chess.ascii());

              const colorOfUser = await SemanticChessGame._findUserColor(myEngine, sources, userWebId);
              console.log(colorOfUser);

              const oppWebId = await SemanticChessGame._findWebIdOfOpponent(myEngine, sources, userWebId);
              console.log(oppWebId);

              deferred.resolve(new SemanticChessGame(gameUrl, userDataUrl, userWebId, oppWebId, colorOfUser, chess, lastMove));
            }
          });
        }
      });

    return deferred.promise;
  }

  static async _findMove(engine, fetch, current, predicate) {
    const deferred = Q.defer();
    let results = [];

    const rdfjsSource = await Utils.getRDFjsSourceFromUrl(current);
    let nextMoveFound = false;

    engine.query(`SELECT * {
      OPTIONAL { <${current}> <${chessOnto}hasSANRecord> ?san. }
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
            const t = await SemanticChessGame._findMove(engine, fetch, data['?nextMove'].value, chessOnto + 'nextHalfMove');
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

    engine.query(`SELECT ?id { ?agentRole <${rdf}type> ?playerRole;
                   <${chessOnto}performedBy> ?id.
                MINUS {?playerRole <${chessOnto}performedBy> <${userWebId}> .}} LIMIT 100`,
      { sources })
      .then(function (result) {
        result.bindingsStream.on('data', function (data) {
          deferred.resolve(data.toObject()['?id'].value);
        });
      });

    return deferred.promise;
  }
}

module.exports = SemanticChessGame;
