const RDFJSSourceFactory = require('./rdfjssourcefactory').fromUrl;
const newEngine = require('@comunica/actor-init-sparql-rdfjs').newEngine;
const Q = require('q');

class InboxFetcher {

  constructor(inboxUrl, fetch) {
    this.inboxUrl = inboxUrl;
    this.fetch = fetch;
    this.alreadyCheckedResources = [];
  }

  /**
   * This method check the inbox for new notifications.
   * @returns {Promise}: a promise that resolves with an array containing the urls of all new notifications since the last time
   * this method was called.
   */
  async checkUserInboxForUpdates() {
    const deferred = Q.defer();
    const newResources = [];
    const rdfjsSource = await RDFJSSourceFactory(this.inboxUrl, this.fetch);
    const self = this;
    const engine = newEngine();

    engine.query(`SELECT ?resource {
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

        result.bindingsStream.on('end', function () {
          deferred.resolve(newResources);
        });
      });

    return deferred.promise;
  }
}

module.exports = InboxFetcher;