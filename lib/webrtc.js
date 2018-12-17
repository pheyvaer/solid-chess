
const Core = require('./core.js');
const DataSync = require('./datasync');
const Q = require('q');
const newEngine = require('@comunica/actor-init-sparql-rdfjs').newEngine;
const N3 = require('n3');
const { literal } = N3.DataFactory;
const rdfjsSourceFromUrl = require('./rdfjssourcefactory').fromUrl;
const rdfjsSourceFromString = require('./rdfjssourcefactory').fromString;
const winston = require('winston');

class WebRTC {

  constructor(userWebId, opponentWebId, fetch, initiator = true, onNewData, onCompletion) {
    this.initiator = initiator;
    this.core = new Core(fetch);
    this.dataSync = new DataSync(fetch);
    this.userWebId = userWebId;
    this.opponentWebId = opponentWebId;
    this.localConnection = null;
    this.sendChannel = null;
    this.receiveChannel = null;
    this.earlyICECandidates = [];
    this.isRemoteDescriptionSet = false;
    this.fetch = fetch;
    this.onNewData = onNewData;
    this.onCompletion = onCompletion;

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

          const inboxUrl = await this.core.getInboxUrl(this.opponentWebId);
          let descLiteral = literal(JSON.stringify(desc.sdp));
          descLiteral = N3.Writer()._encodeLiteral(descLiteral);

        this.logger.debug(descLiteral);

          this.dataSync.sendToOpponentsInbox(inboxUrl, `[ a <http://example.org/WebRTCOffer>; <http://example.org/description> ${descLiteral}].`);
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
        this.dataSync.sendToOpponentsInbox(await this.core.getInboxUrl(this.opponentWebId), `[ a <http://example.org/ICECandidate>; <http://example.org/description> ${descLiteral}].`);
      }
    };

    const sendChannel = connection.createDataChannel('sendDataChannel');
    this.logger.debug('Created send data channel');

    sendChannel.onopen = this.onSendChannelStateChange.bind(this);
    sendChannel.onclose = this.onSendChannelStateChange.bind(this);
    connection.ondatachannel = this.receiveChannelCallback.bind(this);

    return {connection, sendChannel};
  }

  onCreateSessionDescriptionError(error) {
    this.logger.error('Failed to create session description: ' + error.toString());
  }

  async checkForAnswer() {
    this.logger.debug('Checking for answers...');
    const updates = await this.core.checkUserInboxForUpdates(await this.core.getInboxUrl(this.userWebId));

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
    const updates = await this.core.getAllResourcesInInbox(await this.core.getInboxUrl(this.userWebId));

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
    const updates = await this.core.getAllResourcesInInbox(await this.core.getInboxUrl(this.userWebId));

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

                const inboxUrl = await this.core.getInboxUrl(this.opponentWebId);
                let descLiteral = literal(JSON.stringify(desc.sdp));
                descLiteral = N3.Writer()._encodeLiteral(descLiteral);

                this.logger.debug(descLiteral);

                this.dataSync.sendToOpponentsInbox(inboxUrl, `[ a <http://example.org/WebRTCAnswer>; <http://example.org/description> ${descLiteral}].`);
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

  closeDataChannels() {
    this.logger.debug('Closing data channels');
    this.sendChannel.close();
    this.logger.debug('Closed data channel with label: ' + this.sendChannel.label);
    this.receiveChannel.close();
    this.logger.debug('Closed data channel with label: ' + this.receiveChannel.label);
    this.localConnection.close();
    this.localConnection = null;
    this.logger.debug('Closed peer connections');
  }

  receiveChannelCallback(event) {
    this.logger.debug('Receive Channel Callback');
    this.receiveChannel = event.channel;
    this.receiveChannel.onmessage = this.onReceiveMessageCallback.bind(this);
    this.receiveChannel.onopen = this.onReceiveChannelStateChange.bind(this);
    this.receiveChannel.onclose = this.onReceiveChannelStateChange.bind(this);
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

  onSendChannelStateChange() {
    const readyState = this.sendChannel.readyState;
    this.logger.debug('Send channel state is: ' + readyState);

    if (readyState === 'open') {
      clearInterval(this.checkForICECandidateIntervalId);
      this.checkForICECandidateIntervalId = null;
    }

    this._checkIfBothChannelsAreOpen();
  }

  onReceiveChannelStateChange() {
    const readyState = this.receiveChannel.readyState;
    this.logger.debug(`Receive channel state is: ${readyState}`);
    this._checkIfBothChannelsAreOpen();
  }

  _checkIfBothChannelsAreOpen() {
    if (this.onCompletion && this.sendChannel && this.sendChannel.readyState === 'open' && this.receiveChannel && this.receiveChannel.readyState === 'open') {
      this.onCompletion();
    }
  }
}

module.exports = WebRTC;