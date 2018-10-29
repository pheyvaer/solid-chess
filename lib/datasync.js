const auth = require('solid-auth-client');
const URI = require('uri-js');

class DataSync {

  constructor(userDataUrl, opponentDataUrl) {
    this.userDataUrl = userDataUrl;
    this.opponentDataUrl = opponentDataUrl;

    this._setUpListeningForChangesOfOpponent();
  }

  createEmptyFileForUser() {
    return auth.fetch(this.userDataUrl, {
      method: 'PUT',
      body: ''
    });
  }

  executeSPARQLUpdateForUser(query) {
    return auth.fetch(this.userDataUrl, {
      method: 'PATCH',
      body: query,
      headers: {
        'Content-Type': 'application/sparql-update'
      }
    });
  }

  _setUpListeningForChangesOfOpponent() {
    const hostname = URI.parse(this.opponentDataUrl).host;
    const socket = new WebSocket(`wss://${hostname}/`);

    socket.onopen = function() {
    	this.send(`sub ${this.opponentDataUrl}`);
    };

    socket.onmessage = function(msg) {
    	if (msg.data && msg.data.slice(0, 3) === 'pub') {
        console.log(msg);
    	}
    };
  }
}

module.exports = DataSync;
