
const InboxFetcher = require('./inboxfetcher');
const DataSync = require('./datasync');
const Q = require('q');
const newEngine = require('@comunica/actor-init-sparql-rdfjs').newEngine;
const N3 = require('n3');
const { literal } = N3.DataFactory;
const rdfjsSourceFromUrl = require('./rdfjssourcefactory').fromUrl;
const rdfjsSourceFromString = require('./rdfjssourcefactory').fromString;
const winston = require('winston');

class WebRTC {

  constructor(options) {
    this.initiator = options.initiator;
    // we use different fetchers, because we don't want to share the cache
    this.inboxFetcherForAnswers = new InboxFetcher(options.userInboxUrl, options.fetch);
    this.inboxFetcherForOffers = new InboxFetcher(options.userInboxUrl, options.fetch);
    this.inboxFetcherForICECandidates = new InboxFetcher(options.userInboxUrl, options.fetch);
    this.userInboxUrl = options.userInboxUrl;
    this.opponentInboxUrl = options.opponentInboxUrl;
    this.dataSync = new DataSync(options.fetch);
    this.userWebId = options.userWebId;
    this.opponentWebId = options.opponentWebId;
    this.localConnection = null;
    this.sendChannel = null;
    this.receiveChannel = null;
    this.earlyICECandidates = [];
    this.isRemoteDescriptionSet = false;
    this.fetch = options.fetch;
    this.onNewData = options.onNewData;
    this.onCompletion = options.onCompletion;
    this.onClosed = options.onClosed;
    this.onClosedCalled = false;
    this.userInitiatedStop = false;

    this.logger = winston.createLogger({
      level: 'error',
      transports: [
        new winston.transports.Console(),
      ],
      format: winston.format.cli()
    });
  }

  start() {
    const result = this.createLocalConnection();
    this.localConnection = result.connection;
    this.sendChannel = result.sendChannel;

    if (this.initiator) {
      this.createInitialOffer();
    } else {
      this.checkForOfferIntervalId = setInterval(this.checkForOffer.bind(this), 2000);
    }

    this.checkForICECandidateIntervalId = setInterval(this.checkForICECandidate.bind(this), 2000);
  }

  createInitialOffer() {
    this.localConnection.createOffer().then(
      async desc => {
          this.localConnection.setLocalDescription(desc);
          this.logger.debug(`Offer from localConnection\n${desc.sdp}`);

          let descLiteral = literal(JSON.stringify(desc.sdp));
          descLiteral = N3.Writer()._encodeLiteral(descLiteral);

        this.logger.debug(descLiteral);

          this.dataSync.sendToOpponentsInbox(this.opponentInboxUrl, `[ a <http://example.org/WebRTCOffer>; <http://example.org/description> ${descLiteral}].`);
          this.checkForAnswerIntervalId = setInterval(this.checkForAnswer.bind(this), 2000);
    },
      this.onCreateSessionDescriptionError
    );
  }

  createLocalConnection() {
    const config = {
      'iceServers': [
        {
          'urls': 'stun:stun.l.google.com:19302'
        }
      ]
    };
    this.logger.debug('Created local peer connection object localConnection');
    const connection = new RTCPeerConnection(config);

    connection.onicecandidate = async event => {
      this.logger.debug(`ICE candidate: ${event.candidate ? event.candidate.candidate : '(null)'}`);

      if (event.candidate) {
        let descLiteral = literal(JSON.stringify(event.candidate));
        descLiteral = N3.Writer()._encodeLiteral(descLiteral);
        this.dataSync.sendToOpponentsInbox(this.opponentInboxUrl, `[ a <http://example.org/ICECandidate>; <http://example.org/description> ${descLiteral}].`);
      }
    };

    connection.oniceconnectionstatechange = () => {
      if(connection.iceConnectionState === 'disconnected') {
        if (!this.onClosedCalled) {
          this.onClosed(this.userInitiatedStop);
          this.onClosedCalled = true;
        }
      }
    };

    const sendChannel = connection.createDataChannel('sendDataChannel');
    this.logger.debug('Created send data channel');

    sendChannel.onopen = this.onSendChannelOpen.bind(this);
    sendChannel.onclose = this.onSendChannelClose.bind(this);
    connection.ondatachannel = this.receiveChannelCallback.bind(this);

    return {connection, sendChannel};
  }

  onCreateSessionDescriptionError(error) {
    this.logger.error('Failed to create session description: ' + error.toString());
  }

  async checkForAnswer() {
    this.logger.debug('Checking for answers...');
    const updates = await this.inboxFetcherForAnswers.checkUserInboxForUpdates();

    updates.forEach(async fileUrl => {
      const answer = await this.getAnswerFromNotification(fileUrl);

      if (answer) {
        clearInterval(this.checkForAnswerIntervalId);
        this.checkForAnswerIntervalId = null;
        this.dataSync.deleteFileForUser(fileUrl);
        const sdp = JSON.parse(answer.value);
        this.logger.debug(`Answer from remote connection\n${sdp}`);
        this.localConnection.setRemoteDescription({type: 'answer', sdp});
        this.isRemoteDescriptionSet = true;
        this.processEarlyICECandidates();
      }
    });
  }

  async checkForICECandidate() {
    this.logger.debug('Checking for ICE candidates...');
    const updates = await this.inboxFetcherForICECandidates.checkUserInboxForUpdates();

    updates.forEach(async fileUrl => {
      let candidate = await this.getICECandidateFromNotification(fileUrl);

      if (candidate) {
        this.dataSync.deleteFileForUser(fileUrl);
        candidate = JSON.parse(candidate.value);
        this.logger.debug(`ICE candidate from remote connection\n${candidate.candidate}`);

        if (this.isRemoteDescriptionSet) {
          this.localConnection.addIceCandidate(candidate);
        } else {
          this.earlyICECandidates.push(candidate);
        }
      }
    });
  }

  async checkForOffer() {
    this.logger.debug('Checking for offers...');
    const updates = await this.inboxFetcherForOffers.checkUserInboxForUpdates();

    updates.forEach(async fileUrl => {
      if (fileUrl) {
        try {
          const offer = await this.getOfferFromNotification(fileUrl);

          if (offer) {
            clearInterval(this.checkForOfferIntervalId);
            this.checkForOfferIntervalId = null;
            this.dataSync.deleteFileForUser(fileUrl);
            const sdp = JSON.parse(offer.value);
            this.logger.debug(`Offer from remote connection\n${sdp}`);
            this.localConnection.setRemoteDescription({type: 'offer', sdp});
            this.isRemoteDescriptionSet = true;
            this.processEarlyICECandidates();
            this.localConnection.createAnswer().then(
              async desc => {
                this.localConnection.setLocalDescription(desc);
                this.logger.debug(`Answer for remote connection\n${desc.sdp}`);

                let descLiteral = literal(JSON.stringify(desc.sdp));
                descLiteral = N3.Writer()._encodeLiteral(descLiteral);

                this.logger.debug(descLiteral);

                this.dataSync.sendToOpponentsInbox(this.opponentInboxUrl, `[ a <http://example.org/WebRTCAnswer>; <http://example.org/description> ${descLiteral}].`);
              },
              this.onCreateSessionDescriptionError
            );
          }
        } catch (e) {
          console.error(e);
        }
      }
    });
  }

  processEarlyICECandidates() {
    this.earlyICECandidates.forEach(candidate => {
      this.localConnection.addIceCandidate(candidate);
    });
  }

  async getAnswerFromNotification(fileUrl) {
    const deferred = Q.defer();
    const rdfjsSource = await rdfjsSourceFromUrl(fileUrl, this.fetch);

    if (rdfjsSource) {
      const engine = newEngine();

      engine.query(`SELECT ?answer {
    ?s a <http://example.org/WebRTCAnswer>;  <http://example.org/description> ?answer.
  }`,
        {sources: [{type: 'rdfjsSource', value: rdfjsSource}]})
        .then(function (result) {
          result.bindingsStream.on('data', function (data) {
            data = data.toObject();

            deferred.resolve(data['?answer']);
          });

          result.bindingsStream.on('end', function () {
            deferred.resolve(null);
          });
        });
    } else {
      deferred.resolve(null);
    }

    return deferred.promise;
  }

  async getOfferFromNotification(fileUrl) {
    const deferred = Q.defer();
    const rdfjsSource = await rdfjsSourceFromUrl(fileUrl, this.fetch);

    if (rdfjsSource) {
      const engine = newEngine();

      engine.query(`SELECT ?offer {
    ?s a <http://example.org/WebRTCOffer>;  <http://example.org/description> ?offer.
  }`,
        {sources: [{type: 'rdfjsSource', value: rdfjsSource}]})
        .then(function (result) {
          result.bindingsStream.on('data', function (data) {
            data = data.toObject();

            deferred.resolve(data['?offer']);
          });

          result.bindingsStream.on('end', function () {
            deferred.resolve(null);
          });
        });
    } else {
      deferred.resolve(null);
    }

    return deferred.promise;
  }

  async getICECandidateFromNotification(fileUrl) {
    const deferred = Q.defer();
    const rdfjsSource = await rdfjsSourceFromUrl(fileUrl, this.fetch);

    if (rdfjsSource) {
      const engine = newEngine();

      engine.query(`SELECT ?desc {
    ?s a <http://example.org/ICECandidate>;  <http://example.org/description> ?desc.
  }`,
        {sources: [{type: 'rdfjsSource', value: rdfjsSource}]})
        .then(function (result) {
          result.bindingsStream.on('data', function (data) {
            data = data.toObject();

            deferred.resolve(data['?desc']);
          });

          result.bindingsStream.on('end', function () {
            deferred.resolve(null);
          });
        });
    } else {
      deferred.resolve(null);
    }

    return deferred.promise;
  }

  sendData(data) {
    this.sendChannel.send(data);
    this.logger.debug('Sent Data: ' + data);
  }

  stop() {
    this.userInitiatedStop = true;
    this.logger.debug('Closing data channels');

    if (this.sendChannel) {
      this.sendChannel.close();
      this.logger.debug('Closed data channel with label: ' + this.sendChannel.label);
    }

    if (this.receiveChannel) {
      this.receiveChannel.close();
      this.logger.debug('Closed data channel with label: ' + this.receiveChannel.label);
    }

    if (this.localConnection) {
      this.localConnection.close();
      this.localConnection = null;
      this.logger.debug('Closed peer connections');
    }
  }

  receiveChannelCallback(event) {
    this.logger.debug('Receive Channel Callback');
    this.receiveChannel = event.channel;
    this.receiveChannel.onmessage = this.onReceiveMessageCallback.bind(this);
    this.receiveChannel.onopen = this.onReceiveChannelOpen.bind(this);
    this.receiveChannel.onclose = this.onReceiveChannelClose.bind(this);
  }

  async onReceiveMessageCallback(event) {
    this.logger.debug('Received Message');

    try {
      const source = await rdfjsSourceFromString(event.data);

      this.onNewData(source);
    } catch (e) {
      this.logger.error(`Message received, but could not create RDFJSSource: ${event.data}`);
    }
  }

  onSendChannelOpen() {
    const readyState = this.sendChannel.readyState;
    this.logger.debug('Send channel state is: ' + readyState);

    clearInterval(this.checkForICECandidateIntervalId);
    this.checkForICECandidateIntervalId = null;

    this._checkIfBothChannelsAreOpen();
  }

  onSendChannelClose() {
    const readyState = this.sendChannel.readyState;
    this.logger.debug('Send channel state is: ' + readyState);

    if (!this.onClosedCalled) {
      this.onClosed(this.userInitiatedStop);
      this.onClosedCalled = true;
    }
  }

  onReceiveChannelOpen() {
    const readyState = this.receiveChannel.readyState;
    this.logger.debug(`Receive channel state is: ${readyState}`);

    this._checkIfBothChannelsAreOpen();
  }

  onReceiveChannelClose() {
    const readyState = this.receiveChannel.readyState;
    this.logger.debug(`Receive channel state is: ${readyState}`);

    if (!this.onClosedCalled) {
      this.onClosed(this.userInitiatedStop);
      this.onClosedCalled = true;
    }
  }

  _checkIfBothChannelsAreOpen() {
    if (this.onCompletion && this.sendChannel && this.sendChannel.readyState === 'open' && this.receiveChannel && this.receiveChannel.readyState === 'open') {
      this.onCompletion();
    }
  }
}

module.exports = WebRTC;