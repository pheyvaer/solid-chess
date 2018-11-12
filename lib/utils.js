
const N3 = require('n3');
const auth = require('solid-auth-client');
const Q = require('q');
const newEngine = require('@comunica/actor-init-sparql-rdfjs').newEngine;
const namespaces = require('./namespaces');
const { default: data } = require('@solid/query-ldflex');
const uniqid = require('uniqid');

let inboxUrls = {};

async function getInboxUrl(webId) {
  if (!inboxUrls[webId]) {
    inboxUrls[webId] = (await data[webId].inbox).value;
  }

  return inboxUrls[webId];
}

async function getGamesToContinue(webid) {
  const deferred = Q.defer();
  const rdfjsSource = await getRDFjsSourceFromUrl(webid);
  const engine = newEngine();
  const gameUrls = [];

  engine.query(`SELECT ?game ?url {
    <${webid}> <http://example.org/game/participatesIn> ?game.
    ?game <${namespaces.storage}storeIn> ?url
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

  engine.query(`SELECT ?nextMove ?lastMove {
    <${move}> <${namespaces.chess}nextHalfMove> ?nextMove.
    OPTIONAL { <${gameUrl}> <${namespaces.chess}hasLastHalfMove> ?lastMove}
  }`,
    { sources: [ { type: 'rdfjsSource', value: rdfjsSource } ] })
    .then(function (result) {
      result.bindingsStream.on('data', function (data) {
        data = data.toObject();
        moveFound = true;

        const endsGame = (data['?lastMove'] && data['?lastMove'].value === data['?nextMove'].value);

        deferred.resolve({
          move: data['?nextMove'].value,
          endsGame
        });
      });

      result.bindingsStream.on('end', function () {
        if (!moveFound) {
          deferred.resolve({move: null});
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
    <${gameUrl}> <${namespaces.chess}hasFirstHalfMove> ?nextMove.
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
    ?person <${namespaces.game}asksToJoin> ?game.
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

async function fileContainsChessInfo(fileUrl) {
  const deferred = Q.defer();
  const rdfjsSource = await getRDFjsSourceFromUrl(fileUrl);
  const engine = newEngine();

  engine.query(`SELECT * {
    OPTIONAL { ?s <${namespaces.game}asksToJoin> ?o.}
    OPTIONAL { ?s <${namespaces.chess}nextHalfMove> ?o.}
  }`,
    { sources: [ { type: 'rdfjsSource', value: rdfjsSource } ] })
    .then(function (result) {
      result.bindingsStream.on('data', data => {
        deferred.resolve(true);
      });

      result.bindingsStream.on('end', function () {
        deferred.resolve(false);
      });
    });

  return deferred.promise;
}

async function getGameUrl(dataUrl) {
  let url = dataUrl + '#' + uniqid();

  try {
    let  d = await data[url];

    while (d.type) {
      url = dataUrl + '#' + uniqid();
      d = await data[url];
    }
  } catch(e) {
    // this means that response of data[url] returns a 404
    // TODO might be called when you have no access, should check
  } finally {
    console.log(`New game has url ${url}.`);

    return url;
  }
}

async function getFormattedName(webid) {
    const person = data[webid];
    let formattedName = await person.name;

    if (!formattedName) {
        formattedName = null;
        const firstname = await person.givenName;
        const lastname = await person.familyName;

        if (firstname) {
            formattedName = firstname;
        }

        if (lastname) {
            if (formattedName) {
                formattedName += ' ';
            } else {
                formattedName = '';
            }

            formattedName += lastname;
        }
    }

    if (!formattedName) {
        formattedName = webid;
    }

    return formattedName;
}

async function findGamesToJoin(userWebId, dataSync) {
  const deferred = Q.defer();
  const promises = [];
  const updates = await dataSync.checkUserInboxForUpdates(await getInboxUrl(userWebId));
  const results = [];

  updates.forEach(async (fileurl) => {
    const d = Q.defer();
    promises.push(d.promise);

    try {
      const result = await getJoinRequest(fileurl);

      if (result) {
        result.fileUrl = fileurl;
        result.name = await data[result.gameUrl]['http://schema.org/name'];

        if (result.name) {
          result.name = result.name.value;
        }

        result.opponentsName = await getFormattedName(result.opponentWebId);
        results.push(result);
      }

      d.resolve();
    } catch(e) {
      // something went wrong while reading the file, e.g., the file did not contain valid RDF
      d.resolve();
    }
  });

  Q.all(promises).then(() => {
    const gameUrls = [];
    const keep = [];

    results.forEach(r => {
      if (gameUrls.indexOf(r.gameUrl) === -1) {
        gameUrls.push(r.gameUrl);
        keep.push(r);
      }
    });

    deferred.resolve(keep);
  });

  return deferred.promise;
}

async function writePermission(url, dataSync) {
  // TODO We should probably check the ACL of the parent folder to see if we can write if the file doesn't exist and
  // if the file exists, we check the ACL of the file.
  const response = await dataSync.executeSPARQLUpdateForUser(url, 'INSERT DATA {}');
  return response.status === 200;
}

module.exports = {
  getRDFjsSourceFromUrl,
  getNextHalfMove,
  getFirstHalfMove,
  getGamesToContinue,
  getGameUrl,
  fileContainsChessInfo,
  getFormattedName,
  getInboxUrl,
  findGamesToJoin,
  writePermission
};
