
const N3 = require('n3');
const auth = require('solid-auth-client');
const Q = require('q');
const newEngine = require('@comunica/actor-init-sparql-rdfjs').newEngine;
const namespaces = require('./namespaces');
const { default: data } = require('@solid/query-ldflex');
const uniqid = require('uniqid');

let inboxUrls = {};

/**
 * This method returns the inbox of a WebId.
 * @param {string} webId: the WebId for which to find the inbox
 * @returns {Promise}: a promise that resolves with the inbox found via the WebId.
 */
async function getInboxUrl(webId) {
  if (!inboxUrls[webId]) {
    inboxUrls[webId] = (await data[webId].inbox).value;
  }

  return inboxUrls[webId];
}

/**
 * This method returns all the games that a player can continue, based on his WebId.
 * @param webid: the WebId of the player.
 * @returns {Promise}: a promise that resolves to an array with objects.
 * Each object contains the url of the game (gameUrl) and the url where the data of the game is store (storeUrl).
 */
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

/**
 * This method checks a file and returns the next half move of a game.
 * @param {string} fileurl: the url of the file in which to look.
 * @param {string} move: the url of the move for which to find the next one.
 * @param {string} gameUrl: the url of the game.
 * @returns {Promise}: a promise that resolves with {move: string, endsGame: boolean},
 * where move is the url of the next move and endsGame is true when this move is last move of the game.
 * If no move is found, move is null.
 */
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

/**
 * This method checks a file for the first move of a game.
 * @param fileurl: the url of the file in which to look.
 * @param gameUrl: the url of the game for which to find the first move.
 * @returns {Promise}: a promise that resolves with either the url of the first move or null.
 */
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

/**
 * This method checks a file and looks for the a join request.
 * @param fileurl: the url of the file in which to look.
 * @returns {Promise}: a promise that resolves with {opponentWebId: string, gameUrl: string},
 * where opponentWebId is the WebId of the player that initiated the request and gameUrl is the url of the game.
 * If no request was found, null is returned.
 */
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

/**
 * This method returns an RDFJSSource of an url
 * @param {string} url: url of the source
 * @returns {Promise}: a promise that resolve with the corresponding RDFJSSource
 */
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

/**
 * This method checks if a file contains information about a chess game.
 * @param fileUrl: the url of the file to check.
 * @returns {Promise}: a promise that resolves with true if the file contains information about a chess game, else false.
 */
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

/**
 * This method generates a unique url for a chess game based on a given base url.
 * @param baseurl: the base url for the url of the game.
 * @returns {Promise<string>}: a promise that resolves with a unique url.
 */
async function getGameUrl(baseurl) {
  let url = baseurl + '#' + uniqid();

  try {
    let  d = await data[url];

    // We assume that if this url doesn't have a type, the url is unused.
    // Ok, this is not the most fail-safe thing.
    // TODO: check if there are any triples at all.
    while (d.type) {
      url = baseurl + '#' + uniqid();
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

/**
 * This method returns a formatted name for a WebId.
 * @param webid: the WebId for which a formatted name needs to be created.
 * @returns {Promise<string|null>}: a promise that resolvew with the formatted name (string) or
 * null if no name details were found.
 */
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

/**
 * This method finds all games that a player can join.
 * @param userWebId: the WebId of the player for which we want to check for new games.
 * @param dataSync: the DataSync object that is used to access some of the data.
 * @returns {Promise}: a promise that resolves with an array containing all games that the player can join.
 * Each object in the array has the following attributes: fileUrl (url of the file that contained the request),
 * name (name of the chess game), opponentsName (name of the opponent), opponentWebId (WebId of the opponent), and
 * gameUrl (url of the game).
 */
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

    // filter out duplicate requests based on the url of the game
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

/**
 * This method checks if the current user has write access to a file.
 * @param url: the url of the file to check.
 * @param dataSync: the DataSync object to do access.
 * @returns {Promise<boolean>}: a promise that resolves with true if the user has write access, else false.
 */
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
