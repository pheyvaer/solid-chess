#!/usr/bin/env node

const inquirer = require('inquirer');
const SolidClient = require('../node_modules/@solid/cli/src/SolidClient');
const IdentityManager = require('../node_modules/@solid/cli/src/IdentityManager');
const Core = require('../lib/core');
const namespaces = require('../lib/namespaces');
const {Loader} = require('semantic-chess');
const readline = require('readline');
const DataSync = require('../lib/datasync');
const https = require('https');
const Q = require('q');
const Chess = require('chess.js').Chess;

let userWebId;
let oppWebId;
let session;
let client;
let dataSync = new DataSync(fetch);
let semanticGame = null;
let userDataUrl;
let intervalID;
let currentPrompt;
let gamesToJoin = [];
const core = new Core(fetch);

showBanner();
showMainMenu();

function showBanner() {
  console.log(`
   _____         _  _      _    _____  _                     
  / ____|       | |(_)    | |  / ____|| |                    
 | (___    ___  | | _   __| | | |     | |__    ___  ___  ___ 
  \\___ \\  / _ \\ | || | / _\` | | |     | '_ \\  / _ \\/ __|/ __|
  ____) || (_) || || || (_| | | |____ | | | ||  __/\\__ \\\\__ \\
 |_____/  \\___/ |_||_| \\__,_|  \\_____||_| |_| \\___||___/|___/     
                                                 
`);
}

function showMainMenu() {
  inquirer
    .prompt([
      {
        name: 'main-menu',
        type: 'list',
        message: 'What do you want to do?',
        choices: ['Log in', 'How it works', 'Quit'],
        'default': 0
      }
    ])
    .then(answers => {
      const item = answers['main-menu'];

      switch(item) {
        case 'Log in':
          login();
          break;
        case 'How it works':
          console.log(`\nThis is a decentralized Chess game, build on top of Solid [1].
No central sever is required to run or set up a game.
All personal data about the game is stored on your POD.
Requests to join and updates of a game are sent to the inbox of your opponent directly.
You can play the game both in your terminal and browser [2].

[1] https://solid.inrupt.com/
[2] https://pheyvaer.github.io/solid-chess\n`);
          showMainMenu();
          break;
        case 'Quit':
          quit();
      }
    });
}

function showGameMenu() {
  inquirer
    .prompt([
      {
        name: 'game-menu',
        type: 'list',
        message: 'What do you want to do?',
        choices: ['New game', 'Join game', 'Continue game', 'Quit'],
        'default': 0
      }
    ])
    .then(answers => {
      const item = answers['game-menu'];

      switch (item) {
        case 'New game':
          showNewGameMenu();
          break;
        case 'Join game':
          showJoinGameMenu();
          break;
        case 'Continue game':
          showContinueGameMenu();
          break;
        case 'Quit':
          quit();
      }

    });
}

async function showNewGameMenu() {
  const friends = {};
  const allFriends = await core.getAllObjectsFromPredicateForResource(userWebId, namespaces.foaf + 'knows');

  for (const friend of allFriends) {
    let name = await core.getFormattedName(friend.value);

    friends[name] = friend.value;
  }

  inquirer
    .prompt([
      {
        name: 'name',
        type: 'input',
        message: 'What is the name of the game?'
      }, {
        name: 'opponent',
        type: 'list',
        message: 'Who is your opponent',
        choices: Object.keys(friends)
      }
    ])
    .then(async answers => {
      oppWebId = friends[answers['opponent']];

      askForDataUrl(async url => {
        userDataUrl = url;
        semanticGame = await core.setUpNewGame(userDataUrl, userWebId, oppWebId, null, answers['name'], dataSync);

        showGame();
      });
    });
}

function askForDataUrl(callback) {
  inquirer
    .prompt([{
        name: 'dataurl',
        type: 'input',
        message: 'Where do you want to store the game data?',
        'default': core.getDefaultDataUrl(userWebId)
      }
    ])
    .then(async answers => {
      const url = answers['dataurl'];
      if (core.writePermission(url, dataSync)) {
        callback(url);
      } else {
        console.log('🚫 You don\' have access to this file. Please provide another url.');
        askForDataUrl(callback);
      }
    });
}

async function showContinueGameMenu() {
  process.stdout.write('Loading your games...');
  const games = await core.getGamesToContinue(userWebId);
  const gamesMap = {};

  if (games.length > 0) {

    for (const game of games) {
      let name = await core.getObjectFromPredicateForResource(game.gameUrl, namespaces.schema + 'name');

      if (!name) {
        name = game.gameUrl;
      } else {
        name = name.value;
      }

      const loader = new Loader(fetch);
      const oppWebId = await loader.findWebIdOfOpponent(game.gameUrl, userWebId);
      const oppName = await core.getFormattedName(oppWebId);

      game.oppWebId = oppWebId;
      game.oppName = oppName;
      game.name = name;

      const str = `${name} (${oppName})`;
      gamesMap[str] = game;
    }

    clearLine();

    inquirer
      .prompt([
        {
          name: 'continue-game-menu',
          type: 'list',
          message: 'Which game do you want to continue?',
          choices: Object.keys(gamesMap).sort(),
          'default': 0
        }
      ])
      .then(async answers => {
        const gameName = answers['continue-game-menu'];
        const game = gamesMap[gameName];

        loadAndShowGame(game.gameUrl, game.storeUrl);
      });
  } else {
    readline.clearLine(process.stdout);
    readline.cursorTo(process.stdout, 0);
    console.log(`You don't have any games to continue.`);
    showGameMenu();
  }
}

async function showJoinGameMenu(){
  process.stdout.write('Looking for games...');

  await checkForNewGamesToJoin();

  const games = {};

  gamesToJoin.forEach(game => {
    let name = game.name;

    if (!name) {
      name = game.gameUrl;
    }

    games[`${name} (${game.opponentsName})`] = game;
  });

  clearLine();

  if (Object.keys(games).length > 0) {
    games['(Go back)'] = '';

    inquirer
      .prompt([
        {
          name: 'join-game-menu',
          type: 'list',
          message: 'Which game do you want to join?',
          choices: Object.keys(games),
          'default': 0
        }
      ])
      .then(async answers => {
        const gameName = answers['join-game-menu'];
        if (gameName !== '(Go back)') {
          const game = games[gameName];

          askForDataUrl(async url => {
            userDataUrl = url;
            oppWebId = game.opponentWebId;
            semanticGame = await core.joinExistingChessGame(game.gameUrl, game.invitationUrl, oppWebId, userWebId, userDataUrl, dataSync, game.fileUrl);
            showGame();
          });
        } else {
          showGameMenu();
        }
      });
  } else {
    console.log('Sorry, no new games were found.');
    showGameMenu();
  }
}

function clearLine() {
  readline.clearLine(process.stdout);
  readline.cursorTo(process.stdout, 0);
}

function login() {
  inquirer
    .prompt([
      {
        name: 'username',
        type: 'input',
        message: 'What is your username?'
      }, {
        name: 'password',
        type: 'password',
        message: 'What is your password?'
      },{
        name: 'identityProvider',
        type: 'input',
        message: 'What is your identify provider?',
        'default': 'https://solid.community'
      }
    ])
    .then(async answers => {
      console.log('Logging in...');
      const {identityProvider, username, password} = answers;

      const identityManager = IdentityManager.fromJSON('{}');
      client = new SolidClient({ identityManager });

      try {
        session = await client.login(identityProvider, { username, password });
        userWebId = session.idClaims.sub;
        clearLine();
        console.log(`Welcome ${await core.getFormattedName(userWebId)}!`);

        showGameMenu();
      } catch(e) {
        console.error(`Something went wrong when logging in. Try again?`);
        showMainMenu();
      }
    });
}

function quit() {
  console.log('Thanks for playing, bye!');
  process.exit(0);
}

async function fetch(url, options = {method: 'GET'}) {
  const deferred = Q.defer();
  const token = await client.createToken(url, session);

  if (!options.headers) {
    options.headers = {};
  }

  options.headers.Authorization = ` Bearer ${token}`;

  const req = https.request(url, options, (res) => {
    const status = res.statusCode;
    res.setEncoding('utf8');
    let data = '';

    res.on('data', (chunk) => {
      data += chunk;
    });

    res.on('end', () => {
      deferred.resolve({status, text: () => data, url});
    });
  });

  req.on('error', (e) => {
    console.error(`problem with request: ${e.message}`);
  });

  if (options.body) {
    req.write(options.body);
  }

  req.end();

  return deferred.promise;
}

async function checkForNotifications() {
  //console.log('checking...');
  const updates = await core.checkUserInboxForUpdates(await core.getInboxUrl(userWebId));
  //console.log(updates);

  updates.forEach(async (fileurl) => {
    // check for new moves
    core.checkForNewMove(semanticGame, userWebId, fileurl, userDataUrl, dataSync, (san, url) => {
      semanticGame.loadMove(san, {url});

      //readline.cursorTo(process.stdout, 0,-10);

      printASCII();

      if (semanticGame.isOpponentsTurn()) {
        showOpponentsTurn();
      } else {
        stopListeningForEscape();
        showUsersTurn();
      }
    });
  });
}

async function checkForNewGamesToJoin() {
  const updates = await core.checkUserInboxForUpdates(await core.getInboxUrl(userWebId));
  //console.log(updates);

  for (const fileurl of updates) {
    const gameToJoin = await core.getJoinRequest(fileurl, userWebId);

    if (gameToJoin) {
      gamesToJoin.push(await core.processGameToJoin(gameToJoin, fileurl));
    }
  }
}

function showUsersTurn() {
  if (intervalID) {
    clearInterval(intervalID);
  }

  console.log(`It's your turn. (Type "ESC" to quit.)`);

  currentPrompt = inquirer
    .prompt([
      {
        name: 'next-move',
        type: 'input',
        message: 'What is your next move? ([from] => [to])'
      }
    ])
    .then(async answers => {
      const str = answers['next-move'];

      if (str.toLowerCase() !== 'esc') {
        let move;
        const items = str.split(' ');

        if (items.length === 3) {
          const from = items[0];
          const to = items [2];
          move = semanticGame.doMove({from, to});
        }

        if (move) {
          await dataSync.executeSPARQLUpdateForUser(userDataUrl, move.sparqlUpdate);

          if (move.notification) {
            dataSync.sendToOpponentsInbox(await core.getInboxUrl(oppWebId), move.notification);
          }

          printASCII();
          showOpponentsTurn();
        } else {
          console.log('🚫 Incorrect move. Try again.');
          showUsersTurn();
        }
      } else {
        quitGame();
      }
    });
}

function showOpponentsTurn() {
  console.log('Waiting for opponent... ☕️  (Press ESC to quit.)');
  listenForEscape();
  intervalID = setInterval(checkForNotifications, 5000);
}

function listenForEscape() {
  const stdin = process.stdin;

  // without this, we would only get streams once enter is pressed
  stdin.setRawMode( true );

  // resume stdin in the parent process (node app won't quit all by itself
  // unless an error or process.exit() happens)
  stdin.resume();

  // i don't want binary, do you?
  stdin.setEncoding( 'utf8' );

  // on any data into stdin
  stdin.on( 'data', keyPressed);
}

function stopListeningForEscape() {
  process.stdin.off( 'data', keyPressed);
}

function keyPressed( key ){
  if (semanticGame && semanticGame.isOpponentsTurn()) {
    // ctrl-c ( end of text )
    if (key === '\u0003') {
      process.exit();
    } else if (key === '\u001b') {
      stopListeningForEscape();
      quitGame();
    }
  }
}

function quitGame() {
  console.log('Quiting this game. You can continue later.');

  oppWebId = null;
  semanticGame = null;
  userDataUrl = null;

  if (intervalID) {
    clearInterval(intervalID);
    intervalID = null;
  }

  showGameMenu();
}

async function loadAndShowGame(gameUrl, storeUrl) {
  const loader = new Loader(fetch);
  semanticGame = await loader.loadFromUrl(gameUrl, userWebId, storeUrl);
  oppWebId = semanticGame.getOpponentWebId();
  userDataUrl = storeUrl;

  showGame();
}

function showGame() {
  printASCII();

  if (semanticGame.isOpponentsTurn()) {
    showOpponentsTurn();
  } else {
    showUsersTurn();
  }
}

function printASCII() {
  if (semanticGame.getUserColor() === 'w') {
    console.log(semanticGame.getChess().ascii());
  } else {
    const board = new Chess(semanticGame.getChess().fen()).board();

    process.stdout.write(`   +------------------------+\n`);
    for (let i = board.length - 1; i >= 0; i --) {
      for (let j = board[i].length - 1; j >= 0; j --) {
        if (j === board[i].length - 1) {
          process.stdout.write(` ${board.length - i} |`);
        }

        const square = board[i][j];

        if (square) {
          let piece = square.type;

          if (square.color === 'w') {
            piece = piece.toUpperCase();
          }

          process.stdout.write(` ${piece} `);
        } else {
          process.stdout.write(' . ');
        }

        if (j === 0) {
          process.stdout.write(`|\n`);
        }
      }
    }

    process.stdout.write(`   +------------------------+\n`);
    process.stdout.write(`     h  g  f  e  d  c  b  a\n\n`);
  }
}
