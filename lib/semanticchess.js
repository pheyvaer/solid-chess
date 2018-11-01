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

    const rdfjsSource = await SemanticChessGame._getRDFjsSourceFromUrl(current);
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

  static _getRDFjsSourceFromUrl(url) {
    const deferred = Q.defer();

    auth.fetch(url)
      .then(async res => {
        if (res.status === 404) {
          deferred.reject(404);
        } else {
          const body = await res.text();
          const store = N3.Store();
          const parser = N3.Parser({baseIRI: res.url});

          parser.parse(body, (err, quad, prefixes) => {
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

              deferred.resolve(source);
            }
          });
        }
      });

    return deferred.promise;
  }
}

module.exports = SemanticChessGame;
