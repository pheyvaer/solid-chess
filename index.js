const Chessboard = require('./lib/chessboard');
const Chess = require('chess.js');
const SemanticChessGame = require('./lib/semanticchess');
const auth = require('solid-auth-client');
const DataSync = require('./lib/datasync');
const Utils = require('./lib/utils');
const chessOnto = 'http://purl.org/NET/rdfchess/ontology/';
const joinGameRequest = 'http://example.org/game/asksToJoin';
const Q = require('q');

let userWebId;
let semanticGame;
let dataSync;
let board;

$('#login-btn').click(() => {
  auth.popupLogin({ popupUri: 'popup.html' });
});

async function setUpNewChessGame(userDataUrl, oppDataUrl, userWebId, oppWebId) {
  const userInboxUrl = await Utils.getInboxUrl(userWebId);
  const opponentInboxUrl = await Utils.getInboxUrl(oppWebId);
  dataSync = new DataSync(userDataUrl, userInboxUrl, opponentInboxUrl);
  await dataSync.createEmptyFileForUser();

  const game = new Chess();
  semanticGame = new SemanticChessGame(userDataUrl + '#game', userDataUrl, userWebId, oppWebId, 'white', game);
  dataSync.executeSPARQLUpdateForUser(`INSERT DATA {${semanticGame.getGameRDF()}}`);
  dataSync.sendToOpponentsInbox(`<${userWebId}> <${joinGameRequest}> <${semanticGame.getUrl()}>.`);

  setUpBoard(game, semanticGame);
}

async function JoinExistingChessGame(gameUrl, userWebId, userDataUrl) {
  const userInboxUrl = await Utils.getInboxUrl(userWebId);
  semanticGame = await SemanticChessGame.generateFromUrl(gameUrl, userWebId, userDataUrl);
  const opponentInboxUrl = await Utils.getInboxUrl(semanticGame.getOpponentWebId());
  dataSync = new DataSync(userDataUrl, userInboxUrl, opponentInboxUrl);

  await dataSync.createEmptyFileForUser();
  dataSync.executeSPARQLUpdateForUser(`INSERT DATA { <${gameUrl}> a <${chessOnto}ChessGame>}`);

  setUpBoard(semanticGame.getChessGame(), semanticGame);
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

  function storeMoveOnPod(piece, target) {
    console.log(piece);
    console.log(`at ${target}`);
  }

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

$('#new-btn').click(() => {
  $('#new-btn').hide();
  $('#join-btn').hide();
  $('#continue-btn').hide();
  $('#data-url').hide();
  $('#data-url2').hide();
  $('#opp-url').hide();
  $('#opp-webid').hide();

  const temp = $('<div id="board" style="width: 400px"></div>\n' +
  '<p>Status: <span id="status"></span></p>\n' +
  '<p>FEN: <span id="fen"></span></p>\n' +
  '<p>PGN: <span id="pgn"></span></p>');

  $('body').append(temp);
  setUpNewChessGame($('#data-url').val(), $('#opp-url').val(), userWebId, $('#opp-webid').val());
});

$('#join-btn').click(async () => {
  $('#new-btn').hide();
  $('#join-btn').hide();
  $('#continue-btn').hide();
  $('#data-url').hide();
  $('#data-url2').hide();
  $('#opp-url').hide();
  $('#opp-webid').hide();

  const temp = $('<div id="board" style="width: 400px"></div>\n' +
  '<p>Status: <span id="status"></span></p>\n' +
  '<p>FEN: <span id="fen"></span></p>\n' +
  '<p>PGN: <span id="pgn"></span></p>');

  $('body').append(temp);

  if (!dataSync) {
    const userInboxUrl = await Utils.getInboxUrl(userWebId);
    dataSync = new DataSync($('#data-url').val(), userInboxUrl);
  }

  const games = await findGamesToJoin();

  if (games.length > 0) {
    JoinExistingChessGame(games[0].gameUrl, userWebId, $('#data-url2').val());
    dataSync.deleteFileForUser(games[0].fileUrl);
  } else {
    console.log('No games to join were found.');
  }
});

function updateStatus() {
  var statusEl = $('#status'),
    fenEl = $('#fen'),
    pgnEl = $('#pgn');
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
  fenEl.html(game.fen());
  pgnEl.html(game.pgn());
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

// refresh every 5sec
setInterval(refresh, 5000);
