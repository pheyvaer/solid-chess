const auth = require('solid-auth-client');
const URI = require('uri-js');
const newEngine = require('@comunica/actor-init-sparql-rdfjs').newEngine;
const Q = require('q');
const Utils = require('./utils');

class DataSync {

  constructor() {
    this.engine = newEngine();
    this.alreadyCheckedResources = [];

    //this._setUpListeningForChangesOfInbox();
  }
  
  createEmptyFileForUser(url) {
    return auth.fetch(url, {
      method: 'PUT',
      body: ''
    });
  }

  deleteFileForUser(url) {
    return auth.fetch(url, {
      method: 'DELETE'
    });
  }

  executeSPARQLUpdateForUser(url, query) {
    return auth.fetch(url, {
      method: 'PATCH',
      body: query,
      headers: {
        'Content-Type': 'application/sparql-update'
      }
    });
  }

  sendToOpponentsInbox(url, data) {
    return auth.fetch(url, {
      method: 'POST',
      body: data
    });
  }

  async checkUserInboxForUpdates(inboxUrl) {
    const deferred = Q.defer();
    const newResources = [];
    const rdfjsSource = await Utils.getRDFjsSourceFromUrl(inboxUrl);
    const self = this;

    this.engine.query(`SELECT ?resource {
      ?resource a <http://www.w3.org/ns/ldp#Resource>.
    }`,
      { sources: [ { type: 'rdfjsSource', value: rdfjsSource } ] })
      .then(function (result) {
        result.bindingsStream.on('data', data => {
          data = data.toObject();

          const resource = data['?resource'].value;

          if (self.alreadyCheckedResources.indexOf(resource) === -1) {
            newResources.push(resource);
            self.alreadyCheckedResources.push(resource);
          }
        });

        result.bindingsStream.on('data', function () {
          deferred.resolve(newResources);
        });
      });

    return deferred.promise;
  }

  _setUpListeningForChangesOfInbox() {
    const hostname = URI.parse(this.userInboxUrl).host;
    const socket = new WebSocket(`wss://${hostname}/`);

    socket.onopen = function() {
    	this.send(`sub ${this.userInboxUrl}`);
    };

    socket.onmessage = function(msg) {
    	if (msg.data && msg.data.slice(0, 3) === 'pub') {
        console.log(msg);
    	}
    };
  }
}

module.exports = DataSync;
