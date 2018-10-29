const Chessboard = require('./lib/chessboard');
const Chess = require('chess.js');
const SemanticChessGame = require('./lib/semanticchess');
const auth = require('solid-auth-client');
const DataSync = require('./lib/datasync');

let userWebId;
let semanticGame;
let dataSync;

$('#login-btn').click(() => {
  auth.popupLogin({ popupUri: 'popup.html' });
});

function setUpNewChessGame(userDataUrl, oppDataUrl, userWebId, oppWebId) {
  dataSync = new DataSync(userDataUrl, oppDataUrl);
  
  dataSync.createEmptyFileForUser()
  .then(() => {
    const game = new Chess();
    setUpBoard(game);

    semanticGame = new SemanticChessGame(userDataUrl + '#game', userDataUrl, userWebId, oppWebId);

    dataSync.executeSPARQLUpdateForUser(`INSERT DATA {${semanticGame.getGameRDF()}}`);
  });
}

function JoinExistingChessGame(gameUrl, oppDataUrl, userWebId) {
  const game = new Chess();

  SemanticChessGame.generateFromUrl(gameUrl, userWebId);

  setUpBoard(game);
}

function setUpBoard(game) {
  var board,
    statusEl = $('#status'),
    fenEl = $('#fen'),
    pgnEl = $('#pgn');

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

    let sparqlQuery = semanticGame.addMove(move.san);

    dataSync.executeSPARQLUpdateForUser(sparqlQuery);

    updateStatus();
  };

  // update the board position after the piece snap
  // for castling, en passant, pawn promotion
  var onSnapEnd = function() {
    board.position(game.fen());
  };

  var updateStatus = function() {
    var status = '';

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

  function storeMoveOnPod(piece, target) {
    console.log(piece);
    console.log(`at ${target}`);
  }

  var cfg = {
    draggable: true,
    position: 'start',
    onDragStart: onDragStart,
    onDrop: onDrop,
    onSnapEnd: onSnapEnd
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
    $('#opp-url').show();
    $('#opp-webid').show();

    userWebId = session.webId;
  } else {
    $('#new-btn').hide();
    $('#join-btn').hide();
    $('#continue-btn').hide();
    $('#data-url').hide();
    $('#opp-url').hide();
    $('#opp-webid').hide();
  }
});

$('#new-btn').click(() => {
  $('#new-btn').hide();
  $('#join-btn').hide();
  $('#continue-btn').hide();
  $('#data-url').hide();
  $('#opp-url').hide();
  $('#opp-webid').hide();

  const temp = $('<div id="board" style="width: 400px"></div>\n' +
  '<p>Status: <span id="status"></span></p>\n' +
  '<p>FEN: <span id="fen"></span></p>\n' +
  '<p>PGN: <span id="pgn"></span></p>');

  $('body').append(temp);
  setUpNewChessGame($('#data-url').val(), $('#opp-url').val(), userWebId, $('#opp-webid').val());
});

$('#join-btn').click(() => {
  $('#new-btn').hide();
  $('#join-btn').hide();
  $('#continue-btn').hide();
  $('#data-url').hide();
  $('#opp-url').hide();
  $('#opp-webid').hide();

  const temp = $('<div id="board" style="width: 400px"></div>\n' +
  '<p>Status: <span id="status"></span></p>\n' +
  '<p>FEN: <span id="fen"></span></p>\n' +
  '<p>PGN: <span id="pgn"></span></p>');

  $('body').append(temp);

  JoinExistingChessGame($('#game-url').val(), $('#opp-url').val(), userWebId);
});
