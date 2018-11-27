const inquirer = require('inquirer');
const SolidClient = require('../node_modules/@solid/cli/src/SolidClient');
const IdentityManager = require('../node_modules/@solid/cli/src/IdentityManager');
const Utils = require('../lib/utils');
const { default: data } = require('@solid/query-ldflex');
const {Loader} = require('semantic-chess');
const readline = require('readline');
const DataSync = require('../lib/datasync');
const https = require('https');
const Q = require('q');

let userWebId;
let oppWebId;
let session;
let client;
let dataSync = new DataSync();
let semanticGame = null;
let userDataUrl;
let intervalID;

showMainMenu();

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
          console.log(`\nThis is a decentralized Chess app, build on top of [Solid](https://solid.inrupt.com/).
No central sever is required to run or set up a game.
All personal data about the game is stored on your POD.
Requests to join and updates of a game are sent to the inbox of your opponent directly.\n`);
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

  for await (const friend of data[userWebId].friends) {
    let name = await Utils.getFormattedName(friend.value);

    friends[name] = friend;
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
      }, {
        name: 'dataurl',
        type: 'input',
        message: 'Where do you want to store the game data?'
      }
    ])
    .then(answers => {
      console.log(answers);
    });
}

async function showContinueGameMenu() {
  process.stdout.write('Loading your games...');
  const games = await Utils.getGamesToContinue(userWebId);
  const gamesMap = {};

  if (games.length > 0) {

    for (const game of games) {
      let name = await data[game.gameUrl]['http://schema.org/name'];

      if (!name) {
        name = game.gameUrl;
      } else {
        name = name.value;
      }

      const loader = new Loader();
      const oppWebId = await loader.findWebIdOfOpponent(game.gameUrl, userWebId);
      const oppName = await Utils.getFormattedName(oppWebId);

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

        const loader = new Loader();
        semanticGame = await loader.loadFromUrl(game.gameUrl, userWebId, game.storeUrl);
        oppWebId = semanticGame.getOpponentWebId();
        userDataUrl = game.storeUrl;

        console.log(semanticGame.getChess().ascii());

        if (semanticGame.isOpponentsTurn()) {
          showOpponentsTurn();
        } else {
          showUsersTurn();
        }
      });
  } else {
    readline.clearLine(process.stdout);
    readline.cursorTo(process.stdout, 0);
    console.log(`You don't have any games to continue.`);
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
      const {identityProvider, username, password} = answers;

      const identityManager = IdentityManager.fromJSON('{}');
      client = new SolidClient({ identityManager });

      try {
        session = await client.login(identityProvider, { username, password });
        userWebId = session.idClaims.sub;
        console.log(`Welcome ${await Utils.getFormattedName(userWebId)}!`);

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
  const updates = await dataSync.checkUserInboxForUpdates(await Utils.getInboxUrl(userWebId), fetch);
  //console.log(updates);

  updates.forEach(async (fileurl) => {
    // check for new moves
    Utils.checkForNewMove(semanticGame, userWebId, fileurl, userDataUrl, dataSync, fetch, (san, url) => {
      semanticGame.loadMove(san, {url});

      //readline.cursorTo(process.stdout, 0,-10);

      console.log(semanticGame.getChess().ascii());

      if (semanticGame.isOpponentsTurn()) {
        showOpponentsTurn();
      } else {
        showUsersTurn();
      }
    });
  });
}

function showUsersTurn() {
  if (intervalID) {
    clearInterval(intervalID);
  }

  console.log(`It's your turn.`);
  inquirer
    .prompt([
      {
        name: 'next-move',
        type: 'input',
        message: 'What is your next move? ([from] => [to])'
      }
    ])
    .then(async answers => {
      const str = answers['next-move'];
      const items = str.split(' ');
      const from = items[0];
      const to = items [2];
      const move = semanticGame.doMove({from, to});

      if (move) {
        await dataSync.executeSPARQLUpdateForUser(userDataUrl, move.sparqlUpdate, fetch);

        if (move.notification) {
          dataSync.sendToOpponentsInbox(await Utils.getInboxUrl(oppWebId), move.notification, fetch);
        }

        console.log(semanticGame.getChess().ascii());
        showOpponentsTurn();
      } else {
        console.log('Incorrect move. Try again.');
        showUsersTurn();
      }
    });
}

function showOpponentsTurn() {
  console.log('Waiting for opponent...');
  intervalID = setInterval(checkForNotifications, 5000);
}