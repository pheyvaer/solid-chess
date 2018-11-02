
const N3 = require('n3');
const auth = require('solid-auth-client');
const Q = require('q');
const newEngine = require('@comunica/actor-init-sparql-rdfjs').newEngine;
const chessOnto = 'http://purl.org/NET/rdfchess/ontology/';
const joinGameRequest = 'http://example.org/game/asksToJoin';

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

async function getGamesToContinue(webid) {
  const deferred = Q.defer();
  const rdfjsSource = await getRDFjsSourceFromUrl(webid);
  const engine = newEngine();
  const gameUrls = [];

  engine.query(`SELECT ?game {
    <${webid}> <http://example.org/game/participatesIn> ?game.
  }`,
    { sources: [ { type: 'rdfjsSource', value: rdfjsSource } ] })
    .then(function (result) {
      result.bindingsStream.on('data', async function (data) {
        data = data.toObject();

        gameUrls.push(data['?game'].value);
      });

      result.bindingsStream.on('end', function () {
        deferred.resolve(gameUrls);
      });
    });

  return deferred.promise;
}

async function getNextHalfMove(fileurl, move) {
  const deferred = Q.defer();
  const rdfjsSource = await getRDFjsSourceFromUrl(fileurl);
  const engine = newEngine();

  engine.query(`SELECT ?nextMove {
    <${move}> <${chessOnto}nextHalfMove> ?nextMove.
  }`,
    { sources: [ { type: 'rdfjsSource', value: rdfjsSource } ] })
    .then(function (result) {
      result.bindingsStream.on('data', function (data) {
        data = data.toObject();

        deferred.resolve(data['?nextMove'].value);
      });

      result.bindingsStream.on('end', function () {
        deferred.resolve(null);
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

module.exports = {
  getInboxUrl,
  getRDFjsSourceFromUrl,
  getNextHalfMove,
  getSAN,
  getJoinRequest,
  getGamesToContinue
}
