const Chessboard = require('./lib/chessboard');
const Chess = require('chess.js');
const SemanticChessGame = require('./lib/semanticchess');
const auth = require('solid-auth-client');
const DataSync = require('./lib/datasync');
const Utils = require('./lib/utils');
const chessOnto = 'http://purl.org/NET/rdfchess/ontology/';
const joinGameRequest = 'http://example.org/game/asksToJoin';
const storeIn = 'http://example.org/storage/storeIn';
const Q = require('q');

let userWebId;
let semanticGame;
let dataSync;
let board;

$('#login-btn').click(() => {
  auth.popupLogin({ popupUri: 'popup.html' });
});

function setUpForEveryGameOption() {
  $('#game').removeClass('hidden');
}

function setUpAfterEveryGameOptionIsSetUp() {
  // refresh every 5sec
  setInterval(refresh, 5000);
}

async function setUpNewChessGame(userDataUrl, userWebId, oppWebId) {

  setUpForEveryGameOption();
  const userInboxUrl = await Utils.getInboxUrl(userWebId);
  const opponentInboxUrl = await Utils.getInboxUrl(oppWebId);
  dataSync = new DataSync(userDataUrl, userInboxUrl, opponentInboxUrl);
  await dataSync.createEmptyFileForUser();

  const game = new Chess();
  const gameUrl = Utils.getGameUrl(userDataUrl);
  semanticGame = new SemanticChessGame(gameUrl, userDataUrl, userWebId, oppWebId, 'white', game);

  dataSync.executeSPARQLUpdateForUser(`INSERT DATA {${semanticGame.getGameRDF()}}`);
  dataSync.executeSPARQLUpdateForUser(`INSERT DATA { <${gameUrl}> <${storeIn}> <${userDataUrl}>}`);
  dataSync.sendToOpponentsInbox(`<${userWebId}> <${joinGameRequest}> <${semanticGame.getUrl()}>.`);

  setUpBoard(game, semanticGame);
  setUpAfterEveryGameOptionIsSetUp();
}

async function JoinExistingChessGame(gameUrl, userWebId, userDataUrl) {
  const userInboxUrl = await Utils.getInboxUrl(userWebId);
  semanticGame = await SemanticChessGame.generateFromUrl(gameUrl, userWebId, userDataUrl);
  const opponentInboxUrl = await Utils.getInboxUrl(semanticGame.getOpponentWebId());
  dataSync = new DataSync(userDataUrl, userInboxUrl, opponentInboxUrl);

  await dataSync.createEmptyFileForUser();
  dataSync.executeSPARQLUpdateForUser(`INSERT DATA {
    <${gameUrl}> a <${chessOnto}ChessGame>;
      <${storeIn}> <${userDataUrl}>.
  }`);

  setUpBoard(semanticGame.getChessGame(), semanticGame);
  setUpAfterEveryGameOptionIsSetUp();
}

async function ContinueExistingChessGame(gameUrl, userWebId) {
  const userInboxUrl = await Utils.getInboxUrl(userWebId);
  semanticGame = await SemanticChessGame.generateFromUrl(gameUrl, userWebId, userDataUrl);
}

function setUpBoard(game, semanticGame) {
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

  var onDrop = function(source, target) {
    // see if the move is legal
    var move = game.move({
      from: source,
      to: target,
      promotion: 'q' // NOTE: always promote to a queen for example simplicity
    });

    // illegal move
    if (move === null) return 'snapback';

    let result = semanticGame.addMove(move.san);

    dataSync.executeSPARQLUpdateForUser(result.sparqlUpdate);

    if (result.notification) {
      dataSync.sendToOpponentsInbox(result.notification);
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

  updateStatus();
}

auth.trackSession(async session => {
  const loggedIn = !!session;
  console.log(`logged in: ${loggedIn}`);

  if (loggedIn) {
    $('#login-btn').hide();
    $('#new-btn').show();
    $('#join-btn').show();
    $('#continue-btn').show();
    $('#data-url').show();
    $('#data-url2').show();
    $('#opp-url').show();
    $('#opp-webid').show();

    userWebId = session.webId;
    $('#user-name').removeClass('hidden');
    $('#user-name').text('We have a user!');
  } else {
    $('#new-btn').hide();
    $('#join-btn').hide();
    $('#continue-btn').hide();
    $('#data-url').hide();
    $('#data-url2').hide();
    $('#opp-url').hide();
    $('#opp-webid').hide();
  }
});

function afterGameOption() {
  $('#data-url2').hide();
  $('#opp-url').hide();
  // $('#opp-webid').hide();
  $('#game-options').addClass('hidden');
  //$('#game').removeClass('hidden');

  const temp = $('<div id="board" style="width: 400px"></div>\n' +
  '<p>Status: <span id="status"></span></p>');
  $('#game').append(temp);
}

$('#new-btn').click(() => {
  afterGameOption();
  $('#new-game-options').removeClass('hidden');
  $('#data-url').prop('value', 'https://ph_test.solid.community/public/chess.ttl');
  //setUpNewChessGame($('#data-url').val(), $('#opp-url').val(), userWebId, $('#opp-webid').val());
});

$('#start-new-game-btn').click(() => {
  $('#new-game-options').addClass('hidden');

  if ($('#data-url').val() !== userWebId) {
    setUpNewChessGame($('#data-url').val(), userWebId, $('#opp-webid').val());
  } else {
    console.warn('We are pretty sure you do not want remove your WebID.');
  }
});

$('#join-btn').click(async () => {
  afterGameOption();
  $('#join-game-options').removeClass('hidden');

  if (!dataSync) {
    const userInboxUrl = await Utils.getInboxUrl(userWebId);
    dataSync = new DataSync($('#data-url').val(), userInboxUrl);
  }

  const games = await findGamesToJoin();
  $('#join-looking').addClass('hidden');

  if (games.length > 0) {
    $('#join-form').removeClass('hidden');
    const $select = $('#game-urls');

    games.forEach(game => {
      $select.append($(`<option value="${game.gameUrl}">${game.gameUrl}</option>`));
    });
  } else {
    $('#no-join').removeClass('hidden');
  }

  // if (games.length > 0) {
  //   JoinExistingChessGame(games[0].gameUrl, userWebId, $('#data-url2').val());
  //   dataSync.deleteFileForUser(games[0].fileUrl);
  // } else {
  //   console.log('No games to join were found.');
  // }
});

$('#continue-btn').click(async () => {
  afterGameOption();

  if (!dataSync) {
    const userInboxUrl = await Utils.getInboxUrl(userWebId);
    dataSync = new DataSync($('#data-url').val(), userInboxUrl);
  }

  const gameUrls = await Utils.getGamesToContinue(userWebId);

  if (gameUrls.length > 0) {
    const gameUrl = gameUrls[0];
    ContinueExistingChessGame(gameUrl, userWebId);
  } else {
    console.log('No games to continue were found.');
  }
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
    const updates = await dataSync.checkUserInboxForUpdates();

    updates.forEach(async (fileurl) => {
      const lastMoveUrl = semanticGame.getLastMove().url;
      const nextMoveUrl = await Utils.getNextHalfMove(fileurl, lastMoveUrl);

      if (nextMoveUrl) {
        console.log(nextMoveUrl);
        dataSync.deleteFileForUser(fileurl);

        dataSync.executeSPARQLUpdateForUser(`INSERT DATA {
          <${lastMoveUrl}> <${chessOnto}nextHalfMove> <${nextMoveUrl}>.
        }`);

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
  const updates = await dataSync.checkUserInboxForUpdates();
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
