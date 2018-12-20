const URI = require('uri-js');

/**
 * A class with helper methods for read and write of Solid PODs.
 */
class DataSync {

  /**
   * The constructor initiates a DataSync instance.
   */
  constructor(fetch) {
    this.fetch = fetch;

    //this._setUpListeningForChangesOfInbox();
  }

  /**
   * This method creates an empty file for the given url. It overwrites existing files.
   * @param url: the url of the empty file
   * @returns {Promise}: the promise from auth.fetch().
   */
  createEmptyFileForUser(url) {
    return this.fetch(url, {
      method: 'PUT',
      body: ''
    });
  }

  /**
   * This method deletes a file.
   * @param url: the url of the file that needs to be deleted.
   * @returns {Promise}: the promise from auth.fetch().
   */
  deleteFileForUser(url) {
    return this.fetch(url, {
      method: 'DELETE'
    });
  }

  /**
   * This method executes an SPARQL update on a file.
   * @param url: the url of the file that needs to be updated.
   * @param query: the SPARQL update query that needs to be executed.
   * @returns {Promise}: the promise from auth.fetch().
   */
  executeSPARQLUpdateForUser(url, query) {
    return this.fetch(url, {
      method: 'PATCH',
      body: query,
      headers: {
        'Content-Type': 'application/sparql-update'
      }
    });
  }

  /**
   * This method sends a notification to an inbox.
   * @param url: the url of the inbox.
   * @param data: the RDF data representing the notification.
   * @returns {Promise}: the promise from auth.fetch().
   */
  sendToOpponentsInbox(url, data) {
    return this.fetch(url, {
      method: 'POST',
      body: data
    });
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
