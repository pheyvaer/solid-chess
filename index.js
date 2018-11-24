const Chessboard = require('./lib/chessboard');
const {SemanticChess, Loader} = require('semantic-chess');
const auth = require('solid-auth-client');
const DataSync = require('./lib/datasync');
const Utils = require('./lib/utils');
const namespaces = require('./lib/namespaces');
const { default: data } = require('@solid/query-ldflex');

let userWebId;
let semanticGame;
let dataSync = new DataSync();
let board;
let userDataUrl;
let oppWebId;
let gamesToJoin = [];
let gameName;
let refreshIntervalId;
let selectedTheme = 'default';

const fullColor = {
  'w': 'white',
  'b': 'black'
};
const possibleThemes = {
  default: {
    name: 'Classic',
    pieceTheme: 'img/chesspieces/wikipedia/{piece}.png',
    color: {
      black: '#b58863',
      white: '#f0d9b5'
    }
  },
  modern: {
    name: 'Modern',
    pieceTheme: 'img/chesspieces/freevector/{piece}.png',
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
  const gameUrl = await Utils.generateUniqueUrlForResource(userDataUrl);
  semanticGame = new SemanticChess({url: gameUrl, moveBaseUrl: userDataUrl, userWebId, opponentWebId: oppWebId, name: gameName, startPosition});
  const invitation =  await Utils.generateInvitation(userDataUrl, semanticGame.getUrl(), userWebId, oppWebId);

  dataSync.executeSPARQLUpdateForUser(userDataUrl, `INSERT DATA {${semanticGame.getMinimumRDF()} \n <${gameUrl}> <${namespaces.storage}storeIn> <${userDataUrl}>}`);
  dataSync.executeSPARQLUpdateForUser(userWebId, `INSERT DATA { <${gameUrl}> <${namespaces.schema}contributor> <${userWebId}>; <${namespaces.storage}storeIn> <${userDataUrl}>.}`);
  dataSync.executeSPARQLUpdateForUser(userDataUrl, `INSERT DATA {${invitation.sparqlUpdate}}`);
  dataSync.sendToOpponentsInbox(await Utils.getInboxUrl(oppWebId), invitation.notification);

  setUpBoard(semanticGame);
  setUpAfterEveryGameOptionIsSetUp();
}

/**
 * This method joins the player with a game.
 * @param gameUrl: the url of the game to join.
 * @param invitationUrl: the url of the invitation that we accept.
 * @param opponentWebId: the WebId of the opponent of the game, sender of the invitation.
 * @returns {Promise<void>}
 */
async function joinExistingChessGame(gameUrl, invitationUrl, opponentWebId) {
  setUpForEveryGameOption();
  const loader = new Loader();
  semanticGame = await loader.loadFromUrl(gameUrl, userWebId, userDataUrl);
  oppWebId = opponentWebId;
  const response = await Utils.generateResponseToInvitation(userDataUrl, invitationUrl, userWebId, oppWebId, "yes");

  dataSync.executeSPARQLUpdateForUser(userDataUrl, `INSERT DATA {
  <${gameUrl}> a <${namespaces.chess}ChessGame>;
    <${namespaces.storage}storeIn> <${userDataUrl}>.
    
    ${response.sparqlUpdate}
  }`);
  dataSync.executeSPARQLUpdateForUser(userWebId, `INSERT DATA { <${gameUrl}> <${namespaces.schema}contributor> <${userWebId}>; <${namespaces.storage}storeIn> <${userDataUrl}>.}`);
  dataSync.sendToOpponentsInbox(await Utils.getInboxUrl(opponentWebId), response.notification);

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
  const loader = new Loader();
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

    const res = await dataSync.executeSPARQLUpdateForUser(userDataUrl, move.sparqlUpdate);

    if (move.notification) {
      dataSync.sendToOpponentsInbox(await Utils.getInboxUrl(oppWebId), move.notification);
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

  const oppName = await Utils.getFormattedName(oppWebId);

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
    $('#login-required').modal('hide');

    userWebId = session.webId;
    const name = await Utils.getFormattedName(userWebId);

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
    $('#data-url').prop('value', 'https://ph_test.solid.community/public/chess.ttl');

    const $select = $('#possible-opps');

    for await (const friend of data[userWebId].friends) {
        let name = await Utils.getFormattedName(friend.value);

        $select.append(`<option value="${friend}">${name}</option>`);
    }
  } else {
    $('#login-required').modal('show');
  }
});

$('#start-new-game-btn').click(async () => {
  const dataUrl = $('#data-url').val();

  if (await Utils.writePermission(dataUrl, dataSync)) {
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
    $('#join-data-url').prop('value', 'https://ph2.solid.community/public/chess.ttl');
    $('#join-looking').addClass('hidden');

    if (gamesToJoin.length > 0) {
      $('#join-loading').addClass('hidden');
      $('#join-form').removeClass('hidden');
      const $select = $('#game-urls');

      gamesToJoin.forEach(game => {
        let name = game.name;

        if (!name) {
          name = game.gameUrl;
        }

        $select.append($(`<option value="${game.gameUrl}">${name} (${game.opponentsName})</option>`));
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

    if (await Utils.writePermission(userDataUrl, dataSync)){
      $('#join-game-options').addClass('hidden');
      const gameUrl = $('#game-urls').val();

      let i = 0;

      while (i < gamesToJoin.length && gamesToJoin[i].gameUrl !== gameUrl) {
        i++;
      }

      const game = gamesToJoin[i];

      // remove it from the array so it's no longer shown in the UI
      gamesToJoin.splice(i, 1);
      // remove it from the inbox so it's longer loaded when the app is reloaded
      dataSync.deleteFileForUser(game.fileUrl);

      afterGameSpecificOptions();
      joinExistingChessGame(gameUrl, game.invitationUrl, game.opponentWebId);
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

    const games = await Utils.getGamesToContinue(userWebId);

    $('#continue-looking').addClass('hidden');

    if (games.length > 0) {
      $('#continue-loading').addClass('hidden');
      $('#continue-games').removeClass('hidden');

      games.forEach(async game => {
        let name = await data[game.gameUrl]['http://schema.org/name'];

        if (!name) {
          name = game.gameUrl;
        } else {
          name = name.value;
        }

        const loader = new Loader();
        const oppWebId = await loader.findWebIdOfOpponent(game.gameUrl, userWebId);
        const oppName = await Utils.getFormattedName(oppWebId);

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
  const games = await Utils.getGamesToContinue(userWebId);
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
  var statusEl = $('#status');
  var status = '';
  const game = semanticGame.getChess();

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
}


/**
 * This method checks if a new move has been made by the opponent.
 * The necessarily data is stored and the UI is updated.
 * @returns {Promise<void>}
 */
async function checkForNotifications() {
  console.log('Checking for new notifications');

  const updates = await dataSync.checkUserInboxForUpdates(await Utils.getInboxUrl(userWebId));

  updates.forEach(async (fileurl) => {
    // check for new moves
    checkForNewMove(fileurl);

    // check for acceptances of invitations
    const response = await Utils.getResponseToInvitation(fileurl);

    if (response) {
      processResponseInNotification(response, fileurl);
    }

    // check for games to join
    const gameToJoin = await Utils.getJoinRequest(fileurl, userWebId);

    if (gameToJoin) {
      processGameToJoin(gameToJoin, fileurl);
    }
  });
}

/**
 * This method checks for new moves in a notification.
 * @param fileurl: the url of file that contains the notification.
 * @returns {Promise<void>}
 */
async function checkForNewMove(fileurl) {
  const originalMove = await Utils.getOriginalHalfMove(fileurl);

  if (originalMove) {
    let gameUrl = await data[originalMove][namespaces.schema + 'subEvent'];

    if (!gameUrl) {
      gameUrl = await Utils.getGameOfMove(originalMove);

      if (gameUrl) {
        console.error('game: found by using Comunica directly, but not when using LDflex. Caching issue (reported).');
      }
    }

    if (gameUrl) {
      gameUrl = gameUrl.value;
      let game = semanticGame;
      let gameStorageUrl;

      if (!game || game.getUrl() !== gameUrl) {
        gameStorageUrl = await Utils.getStorageForGame(userWebId, gameUrl);

        if (gameStorageUrl) {
          const loader = new Loader();
          game = await loader.loadFromUrl(gameUrl, userWebId, gameStorageUrl);
        } else {
          console.log(`No storage location is found for game "${gameUrl}". Ignoring notification in ${fileurl}.`);
        }
      } else {
        gameStorageUrl = userDataUrl;
      }

      if (game && game.isOpponentsTurn()) {
        const lastMoveUrl = game.getLastMove();
        let nextMoveUrl;
        let endsGame = false;

        if (lastMoveUrl) {
          const r = await Utils.getNextHalfMove(fileurl, lastMoveUrl.url, game.getUrl());
          nextMoveUrl = r.move;
          endsGame = r.endsGame;
        } else {
          nextMoveUrl = await Utils.getFirstHalfMove(fileurl, game.getUrl());
        }

        if (nextMoveUrl) {
          console.log(nextMoveUrl);
          dataSync.deleteFileForUser(fileurl);

          if (lastMoveUrl) {
            let update = `INSERT DATA {
              <${lastMoveUrl.url}> <${namespaces.chess}nextHalfMove> <${nextMoveUrl}>.
            `;

            if (endsGame) {
              update += `<${game.getUrl()}> <${namespaces.chess}hasLastHalfMove> <${nextMoveUrl}>.`;
            }

            update += '}';

            dataSync.executeSPARQLUpdateForUser(gameStorageUrl, update);
          } else {
            dataSync.executeSPARQLUpdateForUser(gameStorageUrl, `INSERT DATA {
              <${game.getUrl()}> <${namespaces.chess}hasFirstHalfMove> <${nextMoveUrl}>.
            }`);
          }

          if (semanticGame && game.getUrl() === semanticGame.getUrl()) {
            let san = await data[nextMoveUrl][namespaces.chess + 'hasSANRecord'];

            if (!san) {
              san = await Utils.getSANRecord(nextMoveUrl);

              if (san) {
                console.error('san: found by using Comunica directly, but not when using LDflex. Caching issue (reported).');
              }
            }

            if (san) {
              semanticGame.loadMove(san.value, {url: nextMoveUrl});
              board.position(semanticGame.getChess().fen());
              updateStatus();
            } else {
              console.error(`The move with url "${nextMoveUrl}" does not have a SAN record defined.`);
            }
          }
        }
      }
    } else {
      console.error(`No game was found for the notification about move "${originalMove}". Ignoring notification in ${fileurl}.`);
      //TODO throw error
    }
  }
}

/**
 * This method processes a notification that contains an invitation to join a game.
 * The resulting game is added to gamesToJoin (arra).
 * @param game: the object representing the relevant game information.
 * @param fileurl: the url of the file containing the notification.
 * @returns {Promise<void>}
 */
async function processGameToJoin(game, fileurl) {
  game.fileUrl = fileurl;
  game.name = await data[game.gameUrl]['http://schema.org/name'];

  if (game.name) {
    game.name = game.name.value;
  }

  game.opponentsName = await Utils.getFormattedName(game.opponentWebId);
  gamesToJoin.push(game);
}

/**
 * This method processes a response to an invitation to join a game.
 * @param response: the object representing the response.
 * @param fileurl: the url of the file containing the notification.
 * @returns {Promise<void>}
 */
async function processResponseInNotification(response, fileurl) {
  const rsvpResponse = await data[response.responseUrl][namespaces.schema + 'rsvpResponse'];
  const gameUrl = await data[response.invitationUrl][namespaces.schema + 'event'];
  let gameName = await data[gameUrl.value].schema_name;
  const loader = new Loader();
  const gameOppWebId = await loader.findWebIdOfOpponent(gameUrl, userWebId);
  const opponentsName = await Utils.getFormattedName(gameOppWebId);

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

  dataSync.executeSPARQLUpdateForUser(await Utils.getStorageForGame(userWebId, gameUrl), `INSERT DATA {
    <${response.invitationUrl}> <${namespaces.schema}result> <${response.responseUrl}>}
  `);
  dataSync.deleteFileForUser(fileurl);
}

$('#clear-inbox-btn').click(async () => {
  const resources = await dataSync.getAllResourcesInInbox(await Utils.getInboxUrl(userWebId));

  resources.forEach(async r => {
    if (await Utils.fileContainsChessInfo(r)) {
      dataSync.deleteFileForUser(r);
    }
  });
});

$('#stop-playing').click(() => {
  $('#game').addClass('hidden');
  $('#game-options').removeClass('hidden');
  $('#how-it-works').removeClass('hidden');
  semanticGame = null;
  board = null;

  // if (refreshIntervalId) {
  //   clearInterval(refreshIntervalId);
  //   refreshIntervalId = null;
  // }
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