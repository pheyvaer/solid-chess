const Chessboard = require('../lib/chessboard');
const {Loader} = require('semantic-chess');
const auth = require('solid-auth-client');
const DataSync = require('../lib/datasync');
const namespaces = require('../lib/namespaces');
const { default: data } = require('@solid/query-ldflex');
const Core = require('../lib/core');

const WebRTC = require('../lib/webrtc');

let userWebId;
let semanticGame;
let dataSync = new DataSync(auth.fetch);
let board;
let userDataUrl;
let oppWebId;
let gamesToJoin = [];
let gameName;
let refreshIntervalId;
let selectedTheme = 'default';
let core = new Core(auth.fetch);
let webrtc = null;

const fullColor = {
  'w': 'white',
  'b': 'black'
};
const possibleThemes = {
  default: {
    name: 'Classic',
    pieceTheme: 'web-app/img/chesspieces/wikipedia/{piece}.png',
    color: {
      black: '#b58863',
      white: '#f0d9b5'
    }
  },
  modern: {
    name: 'Modern',
    pieceTheme: 'web-app/img/chesspieces/freevector/{piece}.png',
    color: {
      black: 'deepskyblue',
      white: 'lightskyblue'
    }
  }
};

$('.login-btn').click(() => {
  auth.popupLogin({ popupUri: 'popup.html' });
});

$('#logout-btn').click(() => {
  auth.logout();
});

$('#refresh-btn').click(checkForNotifications);

$('#theme-btn').click(() => {
  const $modalBody = $('#theme-selector .modal-body');
  $modalBody.empty();

  const keys = Object.keys(possibleThemes);

  keys.forEach(k => {
    const theme = possibleThemes[k];

    const $radio = `<div class="form-check">
                <input type="radio" class="form-check-input" name="theme" id="${k}-theme" value="${k}" ${k === selectedTheme ? 'checked' : ''}>
                <label class="form-check-label" for="${k}-theme">${theme.name}</label>
              </div>`;

    $modalBody.append($radio);
  });

  $('#theme-selector').modal('show');
});

$('#save-theme-btn').click(() => {
  const newTheme = $('input[name="theme"]:checked').val();

  if (newTheme !== selectedTheme) {
    selectedTheme = newTheme;

    if (semanticGame) {
      setUpBoard(semanticGame);
    }
  }

  $('#theme-selector').modal('hide');
});

/**
 * This method does the necessary updates of the UI when the different game options are shown.
 */
function setUpForEveryGameOption() {
  $('#game-loading').removeClass('hidden');
  // $('#game').removeClass('hidden');
}

/**
 * This method does the preparations after every game option has been set up.
 */
function setUpAfterEveryGameOptionIsSetUp() {

}

/**
 * This method sets up a new chess game.
 * @returns {Promise<void>}
 */
async function setUpNewChessGame() {
  setUpForEveryGameOption();

  const startPosition = getNewGamePosition();
  const realTime = getRealTime();
  semanticGame = await core.setUpNewGame(userDataUrl, userWebId, oppWebId, startPosition, gameName, dataSync, realTime);

  if (realTime) {
    let newMoveFound = false;
    webrtc = new WebRTC({
      userWebId,
      userInboxUrl: await core.getInboxUrl(userWebId),
      opponentWebId: oppWebId,
      opponentInboxUrl: await core.getInboxUrl(oppWebId),
      fetch: auth.fetch,
      initiator: true,
      onNewData: rdfjsSource => {
        core.checkForNewMoveForRealTimeGame(semanticGame, dataSync, userDataUrl, rdfjsSource, (san, url) => {
          semanticGame.loadMove(san, {url});
          board.position(semanticGame.getChess().fen());
          updateStatus();
          newMoveFound = true;
        });

        if (!newMoveFound) {
          core.checkForGiveUpOfRealTimeGame(semanticGame, rdfjsSource, (agentUrl, objectUrl) => {
            semanticGame.loadGiveUpBy(agentUrl);
            $('#real-time-opponent-quit').modal('show');
          });
        }
      },
      onCompletion: () => {
        $('#real-time-setup').modal('hide');
      },
      onClosed: (closedByUser) => {
        if (!closedByUser && !$('#real-time-opponent-quit').is(':visible')) {
          $('#real-time-opponent-quit').modal('show');
        }
      }
    });

    $('#real-time-setup .modal-body ul').append('<li>Invitation sent</li>');
    $('#real-time-setup').modal('show');
  }

  setUpBoard(semanticGame);
  setUpAfterEveryGameOptionIsSetUp();
}

/**
 * This method lets a player continue an existing chess game.
 * @param gameUrl: the url of the game to continue.
 * @returns {Promise<void>}
 */
async function continueExistingChessGame(gameUrl) {
  setUpForEveryGameOption();
  const loader = new Loader(auth.fetch);
  semanticGame = await loader.loadFromUrl(gameUrl, userWebId, userDataUrl);
  oppWebId = semanticGame.getOpponentWebId();

  setUpBoard(semanticGame);
  setUpAfterEveryGameOptionIsSetUp();
}

/**
 * This method sets up the chessboard.
 * @param semanticGame: the Semantic Game which drives the board.
 * @returns {Promise<void>}
 */
async function setUpBoard(semanticGame) {
  const game = semanticGame.getChess();

  // do not pick up pieces if the game is over
  // only pick up pieces for the side to move
  const onDragStart = function(source, piece, position, orientation) {
    const userColor = semanticGame.getUserColor();

    if (game.game_over() === true || userColor !== game.turn()) {
      return false;
    }

    if (game.game_over() === true || (userColor !== game.turn() &&
        ((userColor === 'w' && piece.search(/^b/) !== -1) ||
        (userColor === 'b' && piece.search(/^w/) !== -1)))) {
      return false;
    }
  };

  const onDrop = async function(source, target) {
    // see if the move is legal
    const move = semanticGame.doMove({
      from: source,
      to: target,
      promotion: 'q' // NOTE: always promote to a queen for example simplicity
    });

    // illegal move
    if (move === null) return 'snapback';

    await dataSync.executeSPARQLUpdateForUser(userDataUrl, move.sparqlUpdate);

    if (move.notification) {
      if (semanticGame.isRealTime()) {
        // TODO send notification over data channel
        webrtc.sendData(move.notification);
      } else {
        dataSync.sendToOpponentsInbox(await core.getInboxUrl(oppWebId), move.notification);
      }
    }

    updateStatus();
  };

  // update the board position after the piece snap
  // for castling, en passant, pawn promotion
  const onSnapEnd = function() {
    board.position(game.fen());
  };

  const cfg = {
    draggable: true,
    onDragStart: onDragStart,
    onDrop: onDrop,
    onSnapEnd: onSnapEnd,
    position: game.fen(),
    orientation: fullColor[semanticGame.getUserColor()],
    pieceTheme: possibleThemes[selectedTheme].pieceTheme
  };

  board = ChessBoard('board', cfg);

  $('#game').removeClass('hidden');
  $('#game-loading').addClass('hidden');

  $('.black-3c85d').css('background-color', possibleThemes[selectedTheme].color.black);
  $('.white-1e1d7').css('background-color', possibleThemes[selectedTheme].color.white);

  const oppName = await core.getFormattedName(oppWebId);

  $('#opponent-name').text(oppName);

  if (semanticGame.getName()) {
    $('#name-of-the-game').text(semanticGame.getName());
  } else {
    $('#name-of-the-game').text(semanticGame.getUrl());
  }

  updateStatus();
}

auth.trackSession(async session => {
  const loggedIn = !!session;
  //console.log(`logged in: ${loggedIn}`);

  if (loggedIn) {
    $('#user-menu').removeClass('hidden');
    $('#nav-login-btn').addClass('hidden');
    $('#login-required').modal('hide');

    userWebId = session.webId;
    const name = await core.getFormattedName(userWebId);

    if (name) {
      $('#user-name').removeClass('hidden');
      $('#user-name').text(name);
    }

    checkForNotifications();
    // refresh every 5sec
    refreshIntervalId = setInterval(checkForNotifications, 5000);
  } else {
    $('#nav-login-btn').removeClass('hidden');
    $('#user-menu').addClass('hidden');
    $('#game').addClass('hidden');
    $('#new-game-options').addClass('hidden');
    $('#join-game-options').addClass('hidden');
    $('#continue-game-options').addClass('hidden');
    $('#game-options').removeClass('hidden');
    $('#how-it-works').removeClass('hidden');
    userWebId = null;
    semanticGame = null;
    board = null;
    clearInterval(refreshIntervalId);
    refreshIntervalId = null;
  }
});

/**
 * This method updates the UI after a game option has been selected by the player.
 */
function afterGameOption() {
  $('#game-options').addClass('hidden');
  $('#how-it-works').addClass('hidden');
}

function afterGameSpecificOptions() {
}

$('#new-btn').click(async () => {
  if (userWebId) {
    afterGameOption();
    $('#new-game-options').removeClass('hidden');
    $('#data-url').prop('value', core.getDefaultDataUrl(userWebId));

    const $select = $('#possible-opps');

    for await (const friend of data[userWebId].friends) {
        let name = await core.getFormattedName(friend.value);

        $select.append(`<option value="${friend}">${name}</option>`);
    }
  } else {
    $('#login-required').modal('show');
  }
});

$('#start-new-game-btn').click(async () => {
  const dataUrl = $('#data-url').val();

  if (await core.writePermission(dataUrl, dataSync)) {
    $('#new-game-options').addClass('hidden');
    oppWebId = $('#possible-opps').val();
    userDataUrl = dataUrl;
    gameName = $('#game-name').val();
    afterGameSpecificOptions();
    setUpNewChessGame();
  } else {
    $('#write-permission-url').text(dataUrl);
    $('#write-permission').modal('show');
  }
});

$('#join-btn').click(async () => {
  if (userWebId) {
    afterGameOption();
    $('#join-game-options').removeClass('hidden');
    $('#join-data-url').prop('value', core.getDefaultDataUrl(userWebId));
    $('#join-looking').addClass('hidden');

    if (gamesToJoin.length > 0) {
      $('#join-loading').addClass('hidden');
      $('#join-form').removeClass('hidden');
      const $select = $('#game-urls');
      $select.empty();

      gamesToJoin.forEach(game => {
        let name = game.name;

        if (!name) {
          name = game.gameUrl;
        }

        $select.append($(`<option value="${game.gameUrl}">${name} (${game.realTime ? `real time, ` : ''}${game.opponentsName})</option>`));
      });
    } else {
      $('#no-join').removeClass('hidden');
    }
  } else {
    $('#login-required').modal('show');
  }
});

$('#join-game-btn').click(async () => {
  if ($('#join-data-url').val() !== userWebId) {
    userDataUrl = $('#join-data-url').val();

    if (await core.writePermission(userDataUrl, dataSync)){
      $('#join-game-options').addClass('hidden');
      const gameUrl = $('#game-urls').val();

      let i = 0;

      while (i < gamesToJoin.length && gamesToJoin[i].gameUrl !== gameUrl) {
        i++;
      }

      const game = gamesToJoin[i];

      // remove it from the array so it's no longer shown in the UI
      gamesToJoin.splice(i, 1);

      afterGameSpecificOptions();
      setUpForEveryGameOption();
      oppWebId = game.opponentWebId;
      semanticGame = await core.joinExistingChessGame(gameUrl, game.invitationUrl, oppWebId, userWebId, userDataUrl, dataSync, game.fileUrl);

      if (semanticGame.isRealTime()) {
        webrtc = new WebRTC({
          userWebId,
          userInboxUrl: await core.getInboxUrl(userWebId),
          opponentWebId: oppWebId,
          opponentInboxUrl: await core.getInboxUrl(oppWebId),
          fetch: auth.fetch,
          initiator: false,
          onNewData: rdfjsSource => {
            let newMoveFound = false;

            core.checkForNewMoveForRealTimeGame(semanticGame, dataSync, userDataUrl, rdfjsSource, (san, url) => {
              semanticGame.loadMove(san, {url});
              board.position(semanticGame.getChess().fen());
              updateStatus();
              newMoveFound = true;
            });

            if (!newMoveFound) {
              core.checkForGiveUpOfRealTimeGame(semanticGame, rdfjsSource, (agentUrl, objectUrl) => {
                semanticGame.loadGiveUpBy(agentUrl);
                $('#real-time-opponent-quit').modal('show');
              });
            }
          },
          onCompletion: () => {
            $('#real-time-setup').modal('hide');
          },
          onClosed: (closedByUser) => {
            if (!closedByUser && !$('#real-time-opponent-quit').is(':visible')) {
              $('#real-time-opponent-quit').modal('show');
            }
          }
        });

        webrtc.start();

        $('#real-time-setup .modal-body ul').append('<li>Response sent</li><li>Setting up direct connection</li>');
        $('#real-time-setup').modal('show');
      }

      setUpBoard(semanticGame);
      setUpAfterEveryGameOptionIsSetUp();
    } else {
      $('#write-permission-url').text(userDataUrl);
      $('#write-permission').modal('show');
    }
  } else {
    console.warn('We are pretty sure you do not want to remove your WebID.');
  }
});

$('#continue-btn').click(async () => {
  if (userWebId) {
    afterGameOption();

    const $tbody = $('#continue-game-table tbody');
    $tbody.empty();
    $('#continue-game-options').removeClass('hidden');

    const games = await core.getGamesToContinue(userWebId);

    $('#continue-looking').addClass('hidden');

    if (games.length > 0) {
      $('#continue-loading').addClass('hidden');
      $('#continue-games').removeClass('hidden');

      games.forEach(async game => {
        let name = await core.getObjectFromPredicateForResource(game.gameUrl, namespaces.schema + 'name');

        if (!name) {
          name = game.gameUrl;
        } else {
          name = name.value;
        }

        const loader = new Loader(auth.fetch);
        const oppWebId = await loader.findWebIdOfOpponent(game.gameUrl, userWebId);
        const oppName = await core.getFormattedName(oppWebId);

        const $row = $(`
          <tr data-game-url="${game.gameUrl}" class='clickable-row'>
            <td>${name}</td>
            <td>${oppName}</td>
          </tr>`);

        $row.click(function() {
          $('#continue-game-options').addClass('hidden');
          const selectedGame = $(this).data('game-url');

          let i = 0;

          while (i < games.length && games[i].gameUrl !== selectedGame) {
            i ++;
          }

          userDataUrl = games[i].storeUrl;

          afterGameSpecificOptions();
          continueExistingChessGame(selectedGame);
        });

        $tbody.append($row);
      });
    } else {
      $('#no-continue').removeClass('hidden');
    }
  } else {
    $('#login-required').modal('show');
  }
});

$('#continue-game-btn').click(async () => {
  $('#continue-game-options').addClass('hidden');
  const games = await core.getGamesToContinue(userWebId);
  const selectedGame = $('#continue-game-urls').val();
  let i = 0;

  while (i < games.length && games[i].gameUrl !== selectedGame) {
    i ++;
  }

  userDataUrl = games[i].storeUrl;

  afterGameSpecificOptions();
  continueExistingChessGame(selectedGame);
});

/**
 * This method updates the status of the game in the UI.
 */
function updateStatus() {
  const statusEl = $('#status');
  let status = '';
  const game = semanticGame.getChess();

  let moveColor = 'White';

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
}


/**
 * This method checks if a new move has been made by the opponent.
 * The necessarily data is stored and the UI is updated.
 * @returns {Promise<void>}
 */
async function checkForNotifications() {
  console.log('Checking for new notifications');

  const updates = await core.checkUserInboxForUpdates(await core.getInboxUrl(userWebId));

  updates.forEach(async (fileurl) => {
    let newMoveFound = false;
    // check for new moves
    await core.checkForNewMove(semanticGame, userWebId, fileurl, userDataUrl, dataSync, (san, url) => {
      semanticGame.loadMove(san, {url});
      board.position(semanticGame.getChess().fen());
      updateStatus();
      newMoveFound = true;
    });

    if (!newMoveFound) {
      // check for acceptances of invitations
      const response = await core.getResponseToInvitation(fileurl);

      if (response) {
        processResponseInNotification(response, fileurl);
      } else {
        // check for games to join
        const gameToJoin = await core.getJoinRequest(fileurl, userWebId);

        if (gameToJoin) {
          gamesToJoin.push(await core.processGameToJoin(gameToJoin, fileurl));
        }
      }
    }
  });
}

/**
 * This method processes a response to an invitation to join a game.
 * @param response: the object representing the response.
 * @param fileurl: the url of the file containing the notification.
 * @returns {Promise<void>}
 */
async function processResponseInNotification(response, fileurl) {
  const rsvpResponse = await core.getObjectFromPredicateForResource(response.responseUrl, namespaces.schema + 'rsvpResponse');
  let gameUrl = await core.getObjectFromPredicateForResource(response.invitationUrl, namespaces.schema + 'event');

  if (gameUrl) {
    gameUrl = gameUrl.value;

    if (semanticGame && semanticGame.getUrl() === gameUrl && semanticGame.isRealTime()) {
      if (rsvpResponse.value === namespaces.schema + 'RsvpResponseYes') {
        $('#real-time-setup .modal-body ul').append('<li>Invitation accepted</li><li>Setting up direct connection</li>');
        webrtc.start();
      }
    } else {
      let gameName = await core.getObjectFromPredicateForResource(gameUrl, namespaces.schema + 'name');
      const loader = new Loader(auth.fetch);
      const gameOppWebId = await loader.findWebIdOfOpponent(gameUrl, userWebId);
      const opponentsName = await core.getFormattedName(gameOppWebId);

      //show response in UI
      if (!gameName) {
        gameName = gameUrl;
      } else {
        gameName = gameName.value;
      }

      let text;

      if (rsvpResponse.value === namespaces.schema + 'RsvpResponseYes') {
        text = `${opponentsName} accepted your invitation to join "${gameName}"!`;
      } else if (rsvpResponse.value === namespaces.schema + 'RsvpResponseNo') {
        text = `${opponentsName} refused your invitation to join ${gameName}...`;
      }

      if (!$('#invitation-response').is(':visible')) {
        $('#invitation-response .modal-body').empty();
      }

      if ($('#invitation-response .modal-body').text() !== '') {
        $('#invitation-response .modal-body').append('<br/>');
      }

      $('#invitation-response .modal-body').append(text);
      $('#invitation-response').modal('show');

      dataSync.executeSPARQLUpdateForUser(await core.getStorageForGame(userWebId, gameUrl), `INSERT DATA {
    <${response.invitationUrl}> <${namespaces.schema}result> <${response.responseUrl}>}
  `);
    }

    dataSync.deleteFileForUser(fileurl);
  } else {
    console.log(`No game url was found for response ${response.value}.`);
  }
}

$('#clear-inbox-btn').click(async () => {
  const resources = await core.getAllResourcesInInbox(await core.getInboxUrl(userWebId));

  resources.forEach(async r => {
    if (await core.fileContainsChessInfo(r)) {
      dataSync.deleteFileForUser(r);
    }
  });
});

function stopPlaying() {
  $('#game').addClass('hidden');
  $('#game-options').removeClass('hidden');
  $('#how-it-works').removeClass('hidden');
  semanticGame = null;
  board = null;

  if (webrtc) {
    setTimeout(() => {
      webrtc.stop();
      webrtc = null;
    }, 1000);
  }
}

function giveUp() {
  const result = semanticGame.giveUpBy(userWebId);

  dataSync.executeSPARQLUpdateForUser(userDataUrl, `INSERT DATA { ${result.sparqlUpdate} }`);
  webrtc.sendData(result.notification);
}

$('#stop-playing').click(() => {
  if (semanticGame.isRealTime()) {
    $('#real-time-quit').modal('show');
  } else {
    stopPlaying();
  }
});

$('#yes-quit-real-time-btn').click(async () => {
  $('#real-time-quit').modal('hide');

  giveUp();
  stopPlaying();
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

  $('#game').addClass('hidden');
  $('#new-game-options').addClass('hidden');
  $('#join-game-options').addClass('hidden');
  $('#continue-game-options').addClass('hidden');
  $('#game-options').removeClass('hidden');
  $('#how-it-works').removeClass('hidden');
});

$('#opp-quit-ok-btn').click(() => {
  $('#real-time-opponent-quit').modal('hide');

  stopPlaying();
});

/**
 * This method determines what the start position is of a new chess game based on the what the player selected in the UI.
 * @returns {*}
 */
function getNewGamePosition() {
  if ($('#custom-position-chk').prop('checked')) {
    return $('#fen').val();
  } else {
    return null;
  }
}

function getRealTime() {
  return $('#real-time-chk').prop('checked');
}

// todo: this is an attempt to cleanly exit the game, but this doesn't work at the moment
window.onunload = window.onbeforeunload = () => {
  if (semanticGame.isRealTime() && webrtc) {
    giveUp();
  }
};