const Chessboard = require('./lib/chessboard');
const Chess = require('chess.js');
const SemanticChessGame = require('./lib/semanticchess');
const auth = require('solid-auth-client');
const DataSync = require('./lib/datasync');
const Utils = require('./lib/utils');
const chessOnto = 'http://purl.org/NET/rdfchess/ontology/';
const joinGameRequest = 'http://example.org/game/asksToJoin';
const storeIn = 'http://example.org/storage/storeIn';
const participatesIn = 'http://example.org/game/participatesIn';
const Q = require('q');

let userWebId;
let semanticGame;
let dataSync = new DataSync();
let board;
let userDataUrl;
let userInboxUrl;
let opponentInboxUrl;
let oppWebId;

$('#login-btn').click(() => {
  auth.popupLogin({ popupUri: 'popup.html' });
});

async function getUserInboxUrl() {
  if (!userInboxUrl) {
    userInboxUrl = await Utils.getInboxUrl(userWebId);
  }

  return userInboxUrl;
}

async function getOpponentInboxUrl() {
  if (!opponentInboxUrl) {
    opponentInboxUrl = await Utils.getInboxUrl(oppWebId);
  }

  return opponentInboxUrl;
}

async function setUpForEveryGameOption() {
  $('#game').removeClass('hidden');
}

function setUpAfterEveryGameOptionIsSetUp() {
  // refresh every 5sec
  setInterval(refresh, 5000);
}

async function setUpNewChessGame() {
  setUpForEveryGameOption();
  await dataSync.createEmptyFileForUser(userDataUrl);

  const startPosition = getNewGamePosition();
  let game;

  if (startPosition) {
    game = new Chess(startPosition);
  } else {
    game = new Chess();
  }

  const gameUrl = Utils.getGameUrl(userDataUrl);
  semanticGame = new SemanticChessGame(gameUrl, userDataUrl, userWebId, oppWebId, 'white', game);

  dataSync.executeSPARQLUpdateForUser(userDataUrl, `INSERT DATA {${semanticGame.getGameRDF()}}`);
  dataSync.executeSPARQLUpdateForUser(userDataUrl, `INSERT DATA { <${gameUrl}> <${storeIn}> <${userDataUrl}>}`);
  dataSync.executeSPARQLUpdateForUser(userWebId, `INSERT DATA { <${userWebId}> <${participatesIn}> <${gameUrl}>. <${gameUrl}> <${storeIn}> <${userDataUrl}>.}`);
  dataSync.sendToOpponentsInbox(await getOpponentInboxUrl(), `<${userWebId}> <${joinGameRequest}> <${semanticGame.getUrl()}>.`);

  setUpBoard(game, semanticGame);
  setUpAfterEveryGameOptionIsSetUp();
}

async function JoinExistingChessGame(gameUrl) {
  setUpForEveryGameOption();
  semanticGame = await SemanticChessGame.generateFromUrl(gameUrl, userWebId, userDataUrl);
  oppWebId = semanticGame.getOpponentWebId();

  await dataSync.createEmptyFileForUser(userDataUrl);
  dataSync.executeSPARQLUpdateForUser(userDataUrl, `INSERT DATA {
    <${gameUrl}> a <${chessOnto}ChessGame>;
      <${storeIn}> <${userDataUrl}>.
  }`);
  dataSync.executeSPARQLUpdateForUser(userWebId, `INSERT DATA { <${userWebId}> <${participatesIn}> <${gameUrl}>. <${gameUrl}> <${storeIn}> <${userDataUrl}>.}`);

  setUpBoard(semanticGame.getChessGame(), semanticGame);
  setUpAfterEveryGameOptionIsSetUp();
}

async function ContinueExistingChessGame(gameUrl) {
  setUpForEveryGameOption();
  semanticGame = await SemanticChessGame.generateFromUrl(gameUrl, userWebId, userDataUrl);
  oppWebId = semanticGame.getOpponentWebId();

  setUpBoard(semanticGame.getChessGame(), semanticGame);
  setUpAfterEveryGameOptionIsSetUp();
}

async function setUpBoard(game, semanticGame) {
  // do not pick up pieces if the game is over
  // only pick up pieces for the side to move
  var onDragStart = function(source, piece, position, orientation) {
    const userColor = semanticGame.getUserColor()[0];

    if (game.game_over() === true || userColor !== game.turn()) {
      return false;
    }

    if (game.game_over() === true || (userColor !== game.turn() &&
        ((userColor === 'w' && piece.search(/^b/) !== -1) ||
        (userColor === 'b' && piece.search(/^w/) !== -1)))) {
      return false;
    }
  };

  var onDrop = async function(source, target) {
    // see if the move is legal
    var move = game.move({
      from: source,
      to: target,
      promotion: 'q' // NOTE: always promote to a queen for example simplicity
    });

    // illegal move
    if (move === null) return 'snapback';

    let result = semanticGame.addMove(move.san);

    dataSync.executeSPARQLUpdateForUser(userDataUrl, result.sparqlUpdate);

    if (result.notification) {
      dataSync.sendToOpponentsInbox(await getOpponentInboxUrl(), result.notification);
    }

    updateStatus();
  };

  // update the board position after the piece snap
  // for castling, en passant, pawn promotion
  var onSnapEnd = function() {
    board.position(game.fen());
  };

  var cfg = {
    draggable: true,
    position: 'start',
    onDragStart: onDragStart,
    onDrop: onDrop,
    onSnapEnd: onSnapEnd,
    position: game.fen(),
    orientation: semanticGame.getUserColor()
  };

  board = ChessBoard('board', cfg);
  const oppName = await getFormattedName(oppWebId);

  if (oppName) {
    $('#opponent-name').text(oppName);
  } else {
    $('#opponent-name').text(oppWebId);
  }

  updateStatus();
}

auth.trackSession(async session => {
  const loggedIn = !!session;
  console.log(`logged in: ${loggedIn}`);

  if (loggedIn) {
    $('#user-menu').removeClass('hidden');

    userWebId = session.webId;
    const name = await getFormattedName(userWebId);

    if (name) {
      $('#user-name').removeClass('hidden');
      $('#user-name').text(name);
    }
  } else {
    $('#login-btn').removeClass('hidden');
  }
});

function afterGameOption() {
  $('#game-options').addClass('hidden');
  $('#how-it-works').addClass('hidden');
}

function afterGameSpecificOptions() {
  const temp = $(`<div id="board" style="width: 400px"></div>\n
  <div id="game-details">
    <p>Status: <span id="status"></span></p>
    <p>Opponent: <span id="opponent-name"></span></p>
  </div>`);
  $('#game').append(temp);
}

$('#new-btn').click(() => {
  afterGameOption();
  $('#new-game-options').removeClass('hidden');
  $('#data-url').prop('value', 'https://ph_test.solid.community/public/chess.ttl');
});

$('#start-new-game-btn').click(() => {
  $('#new-game-options').addClass('hidden');

  if ($('#data-url').val() !== userWebId) {
    oppWebId = $('#opp-webid').val();
    userDataUrl = $('#data-url').val();
    afterGameSpecificOptions();
    setUpNewChessGame();
  } else {
    console.warn('We are pretty sure you do not want remove your WebID.');
  }
});

$('#join-btn').click(async () => {
  afterGameOption();
  $('#join-game-options').removeClass('hidden');
  $('#join-data-url').prop('value', 'https://ph2.solid.community/public/chess.ttl');

  const games = await findGamesToJoin();
  $('#join-looking').addClass('hidden');

  if (games.length > 0) {
    $('#join-loading').addClass('hidden');
    $('#join-form').removeClass('hidden');
    const $select = $('#game-urls');

    games.forEach(game => {
      $select.append($(`<option value="${game.gameUrl}">${game.gameUrl}</option>`));
    });
  } else {
    $('#no-join').removeClass('hidden');
  }
});

$('#join-game-btn').click(() => {
  $('#join-game-options').addClass('hidden');

  if ($('#join-data-url').val() !== userWebId) {
    userDataUrl = $('#join-data-url').val();
    afterGameSpecificOptions();
    JoinExistingChessGame($('#game-urls').val());
  } else {
    console.warn('We are pretty sure you do not want remove your WebID.');
  }
});

$('#continue-btn').click(async () => {
  afterGameOption();
  $('#continue-game-options').removeClass('hidden');

  const games = await Utils.getGamesToContinue(userWebId);
  $('#continue-looking').addClass('hidden');

  if (games.length > 0) {
    $('#continue-loading').addClass('hidden');
    $('#continue-form').removeClass('hidden');
    const $select = $('#continue-game-urls');

    games.forEach(game => {
      $select.append($(`<option value="${game.gameUrl}">${game.gameUrl}</option>`));
    });
  } else {
    $('#no-continue').removeClass('hidden');
  }
});

$('#continue-game-btn').click(async () => {
  $('#continue-game-options').addClass('hidden');
  const games = await Utils.getGamesToContinue(userWebId);
  const selectedGame = $('#continue-game-urls').val();
  let i = 0;

  while (i < games.length && games[i].gameUrl !== selectedGame) {
    i ++;
  }

  userDataUrl = games[i].storeUrl;

  afterGameSpecificOptions();
  ContinueExistingChessGame(selectedGame);
});

function updateStatus() {
  var statusEl = $('#status');
  var status = '';
  const game = semanticGame.getChessGame();

  var moveColor = 'White';
  if (game.turn() === 'b') {
    moveColor = 'Black';
  }

  // checkmate?
  if (game.in_checkmate() === true) {
    status = 'Game over, ' + moveColor + ' is in checkmate.';
  }

  // draw?
  else if (game.in_draw() === true) {
    status = 'Game over, drawn position';
  }

  // game still on
  else {
    status = moveColor + ' to move';

    // check?
    if (game.in_check() === true) {
      status += ', ' + moveColor + ' is in check';
    }
  }

  statusEl.html(status);
};

$('#refresh-btn').click(refresh);

async function refresh() {
  console.log('refresh started');

  if (semanticGame.isOpponentsTurn()) {
    const updates = await dataSync.checkUserInboxForUpdates(await getUserInboxUrl());

    updates.forEach(async (fileurl) => {
      const lastMoveUrl = semanticGame.getLastMove();
      let nextMoveUrl;

      if (lastMoveUrl) {
        nextMoveUrl = await Utils.getNextHalfMove(fileurl, lastMoveUrl.url);
      } else {
        nextMoveUrl = await Utils.getFirstHalfMove(fileurl, semanticGame.getUrl());
      }

      if (nextMoveUrl) {
        console.log(nextMoveUrl);
        dataSync.deleteFileForUser(fileurl);

        if (lastMoveUrl) {
          dataSync.executeSPARQLUpdateForUser(userDataUrl, `INSERT DATA {
            <${lastMoveUrl.url}> <${chessOnto}nextHalfMove> <${nextMoveUrl}>.
          }`);
        } else {
          dataSync.executeSPARQLUpdateForUser(userDataUrl, `INSERT DATA {
            <${semanticGame.getUrl()}> <${chessOnto}hasFirstHalfMove> <${nextMoveUrl}>.
          }`);
        }

        const san = await Utils.getSAN(nextMoveUrl);
        semanticGame.addMove(san, nextMoveUrl);
        board.position(semanticGame.getChessGame().fen());
        updateStatus();
      }
    });
  }
}

async function findGamesToJoin() {
  const deferred = Q.defer();
  const promises = [];
  const updates = await dataSync.checkUserInboxForUpdates(await getUserInboxUrl());
  const results = [];

  updates.forEach(async (fileurl) => {
    const d = Q.defer();
    promises.push(d.promise);
    const result = await Utils.getJoinRequest(fileurl);

    if (result) {
      result.fileUrl = fileurl;
      results.push(result);
    }

    d.resolve();
  });

  Q.all(promises).then(() => {
    deferred.resolve(results);
  });

  return deferred.promise;
}

$('#clear-inbox-btn').click(async () => {
  const resources = await dataSync.getAllResourcesInInbox(await getUserInboxUrl());

  resources.forEach(r => {
    dataSync.deleteFileForUser(r);
  });
});

$('#custom-position-chk').change(() => {
  if ($('#custom-position-chk').prop('checked')) {
    $('#custom-position').removeClass('hidden');
  } else {
    $('#custom-position').addClass('hidden');
  }
});

$('.btn-cancel').click(() => {
  semanticGame = null;
  oppWebId = null;
  opponentInboxUrl = null;

  $('#game').addClass('hidden');
  $('#new-game-options').addClass('hidden');
  $('#join-game-options').addClass('hidden');
  $('#continue-game-options').addClass('hidden');
  $('#game-options').removeClass('hidden');
  $('#how-it-works').removeClass('hidden');
});

function getNewGamePosition() {
  if ($('#custom-position-chk').prop('checked')) {
    return $('#fen').val();
  } else {
    return null;
  }
}

async function getFormattedName(webid) {
  const names = await Utils.getName(webid);
  let n = null;

  if (names) {
    if (names.fullname) {
      n = names.fullname;
    } else {
      if (names.firstname) {
        n += names.firstname;
      }

      if (names.lastname) {
        n += names.lastname;
      }
    }
  }

  return n;
}
