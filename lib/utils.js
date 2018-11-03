
const N3 = require('n3');
const auth = require('solid-auth-client');
const Q = require('q');
const newEngine = require('@comunica/actor-init-sparql-rdfjs').newEngine;
const chessOnto = 'http://purl.org/NET/rdfchess/ontology/';
const joinGameRequest = 'http://example.org/game/asksToJoin';
const storeIn = 'http://example.org/storage/storeIn';

async function getInboxUrl(webid) {
  const deferred = Q.defer();
  const rdfjsSource = await getRDFjsSourceFromUrl(webid);
  const engine = newEngine();

  engine.query(`SELECT ?inbox {
    <${webid}> <http://www.w3.org/ns/ldp#inbox> ?inbox.
  }`,
    { sources: [ { type: 'rdfjsSource', value: rdfjsSource } ] })
    .then(function (result) {
      result.bindingsStream.on('data', async function (data) {
        data = data.toObject();

        deferred.resolve(data['?inbox'].value);
      });
    });

  return deferred.promise;
}

async function getName(webid) {
  const deferred = Q.defer();
  const rdfjsSource = await getRDFjsSourceFromUrl(webid);
  const engine = newEngine();

  engine.query(`SELECT ?firstname ?lastname ?fullname {
    OPTIONAL {<${webid}> <http://xmlns.com/foaf/0.1/name> ?fullname.}
    OPTIONAL {<${webid}> <http://xmlns.com/foaf/0.1/givenName> ?firstname.}
    OPTIONAL {<${webid}> <http://xmlns.com/foaf/0.1/familyName> ?lastname.}
  }`,
    { sources: [ { type: 'rdfjsSource', value: rdfjsSource } ] })
    .then(function (result) {
      result.bindingsStream.on('data', async function (data) {
        data = data.toObject();

        const result = {};

        if (data['?fullname']) {
          result.fullname = data['?fullname'].value;
        }

        if (data['?firstname']) {
          result.firstname = data['?firstname'].value;
        }

        if (data['?lastname']) {
          result.lastname = data['?lastname'].value;
        }

        deferred.resolve(result);
      });

      result.bindingsStream.on('end', function () {
        deferred.resolve(null);
      });
    });

  return deferred.promise;
}

async function getGamesToContinue(webid) {
  const deferred = Q.defer();
  const rdfjsSource = await getRDFjsSourceFromUrl(webid);
  const engine = newEngine();
  const gameUrls = [];

  engine.query(`SELECT ?game ?url {
    <${webid}> <http://example.org/game/participatesIn> ?game.
    ?game <${storeIn}> ?url
  }`,
    { sources: [ { type: 'rdfjsSource', value: rdfjsSource } ] })
    .then(function (result) {
      result.bindingsStream.on('data', async function (data) {
        data = data.toObject();

        gameUrls.push({
          gameUrl: data['?game'].value,
          storeUrl: data['?url'].value
        });
      });

      result.bindingsStream.on('end', function () {
        deferred.resolve(gameUrls);
      });
    });

  return deferred.promise;
}

async function getNextHalfMove(fileurl, move, gameUrl) {
  const deferred = Q.defer();
  const rdfjsSource = await getRDFjsSourceFromUrl(fileurl);
  const engine = newEngine();
  let moveFound = false;

  engine.query(`SELECT ?nextMove {
    <${move}> <${chessOnto}nextHalfMove> ?nextMove.
  }`,
    { sources: [ { type: 'rdfjsSource', value: rdfjsSource } ] })
    .then(function (result) {
      result.bindingsStream.on('data', function (data) {
        data = data.toObject();
        moveFound = true;

        deferred.resolve(data['?nextMove'].value);
      });

      result.bindingsStream.on('end', function () {
        if (!moveFound) {
          deferred.resolve(null);
        }
      });
    });

  return deferred.promise;
}

async function getFirstHalfMove(fileurl, gameUrl) {
  const deferred = Q.defer();
  const rdfjsSource = await getRDFjsSourceFromUrl(fileurl);
  const engine = newEngine();
  let moveFound = false;

  engine.query(`SELECT ?nextMove {
    <${gameUrl}> <${chessOnto}hasFirstHalfMove> ?nextMove.
  }`,
    { sources: [ { type: 'rdfjsSource', value: rdfjsSource } ] })
    .then(function (result) {
      result.bindingsStream.on('data', function (data) {
        data = data.toObject();
        moveFound = true;

        deferred.resolve(data['?nextMove'].value);
      });

      result.bindingsStream.on('end', function () {
        if (!moveFound) {
          deferred.resolve(null);
        }
      });
    });

  return deferred.promise;
}

async function getJoinRequest(fileurl) {
  const deferred = Q.defer();
  const rdfjsSource = await getRDFjsSourceFromUrl(fileurl);
  const engine = newEngine();

  engine.query(`SELECT ?person ?game {
    ?person <${joinGameRequest}> ?game.
  }`,
    { sources: [ { type: 'rdfjsSource', value: rdfjsSource } ] })
    .then(function (result) {
      result.bindingsStream.on('data', function (data) {
        data = data.toObject();

        deferred.resolve({
          opponentWebId: data['?person'].value,
          gameUrl: data['?game'].value
        });
      });

      result.bindingsStream.on('end', function () {
        deferred.resolve(null);
      });
    });

  return deferred.promise;
}


async function getSAN(move) {
  const deferred = Q.defer();
  const rdfjsSource = await getRDFjsSourceFromUrl(move);
  const engine = newEngine();

  engine.query(`SELECT ?san {
    <${move}> <${chessOnto}hasSANRecord> ?san.
  }`,
    { sources: [ { type: 'rdfjsSource', value: rdfjsSource } ] })
    .then(function (result) {
      result.bindingsStream.on('data', function (data) {
        data = data.toObject();

        deferred.resolve(data['?san'].value);
      });

      result.bindingsStream.on('end', function () {
        deferred.resolve(null);
      });
    });

  return deferred.promise;
}

function getRDFjsSourceFromUrl(url) {
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

function getGameUrl(dataUrl) {
  return dataUrl + '#game';
}

module.exports = {
  getInboxUrl,
  getRDFjsSourceFromUrl,
  getNextHalfMove,
  getFirstHalfMove,
  getSAN,
  getJoinRequest,
  getGamesToContinue,
  getGameUrl,
  getName
}
