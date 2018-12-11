
const Core = require('./core.js');
const DataSync = require('./datasync');
const Q = require('q');
const newEngine = require('@comunica/actor-init-sparql-rdfjs').newEngine;
const N3 = require('n3');
const { literal } = N3.DataFactory;

class WebRTC {

  constructor(userWebId, opponentWebId, fetch, initiator = true) {
    this.initiator = initiator;
    this.core = new Core(fetch);
    this.dataSync = new DataSync(fetch);
    this.userWebId = userWebId;
    this.opponentWebId = opponentWebId;
    this.localConnection = null;
    this.sendChannel = null;
    this.receiveChannel = null;
  }

  start() {
    this.localConnection = this.createLocalConnection();

    if (this.initiator) {
      this.createConnection();
    } else {
      this.checkForOfferIntervalId = setInterval(this.checkForOffer.bind(this), 2000);
    }

    this.checkForICECandidateIntervalId = setInterval(this.checkForICECandidate.bind(this), 2000);
  }

  createConnection() {
    this.sendChannel = this.localConnection.createDataChannel('sendDataChannel');
    console.log('Created send data channel');

    this.localConnection.onicecandidate = async event => {
      console.log(`ICE candidate: ${event.candidate ? event.candidate.candidate : '(null)'}`);

      let descLiteral = literal(JSON.stringify(event.candidate));
      descLiteral = N3.Writer()._encodeLiteral(descLiteral);
      this.dataSync.sendToOpponentsInbox(await this.core.getInboxUrl(this.opponentWebId), `[ a <http://example.org/ICECandidate>; <http://example.org/description> ${descLiteral}].`);
    };

    this.sendChannel.onopen = this.onSendChannelStateChange;
    this.sendChannel.onclose = this.onSendChannelStateChange;
    this.localConnection.ondatachannel = this.receiveChannelCallback;

    this.localConnection.createOffer().then(
      async desc => {
          this.localConnection.setLocalDescription(desc);
          console.log(`Offer from localConnection\n${desc.sdp}`);

          const inboxUrl = await this.core.getInboxUrl(this.opponentWebId);
          let descLiteral = literal(JSON.stringify(desc.sdp));
          descLiteral = N3.Writer()._encodeLiteral(descLiteral);

          console.log(descLiteral);

          this.dataSync.sendToOpponentsInbox(inboxUrl, `[ a <http://example.org/WebRTCOffer>; <http://example.org/description> ${descLiteral}].`);
          this.checkForAnswerIntervalId = setInterval(this.checkForAnswer.bind(this), 2000);
    },
      this.onCreateSessionDescriptionError
    );
  }

  createLocalConnection() {
    const servers = null;
    console.log('Created local peer connection object localConnection');
    return new RTCPeerConnection(servers);
  }

  onCreateSessionDescriptionError(error) {
    console.log('Failed to create session description: ' + error.toString());
  }

  async checkForAnswer() {
    console.log('Checking for answers...');
    const updates = await this.core.checkUserInboxForUpdates(await this.core.getInboxUrl(this.userWebId));

    updates.forEach(async fileUrl => {
      const answer = await this.getAnswerFromNotification(fileUrl);

      if (answer) {
        clearInterval(this.checkForAnswerIntervalId);
        this.checkForAnswerIntervalId = null;
        this.dataSync.deleteFileForUser(fileUrl);
        const sdp = JSON.parse(answer);
        console.log(`Answer from remote connection\n${sdp}`);
        this.localConnection.setRemoteDescription({type: 'answer', sdp});
      }
    });
  }

  async checkForICECandidate() {
    console.log('Checking for ICE candidates...');
    const updates = await this.core.getAllResourcesInInbox(await this.core.getInboxUrl(this.userWebId));

    updates.forEach(async fileUrl => {
      let candidate = await this.getICECandidateFromNotification(fileUrl);

      if (candidate) {
        this.dataSync.deleteFileForUser(fileUrl);
        candidate = JSON.parse(candidate.value);
        console.log(`ICE candidate from remote connection\n${candidate}`);
        this.localConnection.addIceCandidate(candidate);
      }
    });
  }

  async checkForOffer() {
    console.log('Checking for offers...');
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
            console.log(`Offer from remote connection\n${sdp}`);
            this.localConnection.setRemoteDescription({type: 'offer', sdp});
            this.localConnection.createAnswer().then(
              async desc => {
                this.localConnection.setLocalDescription(desc);
                console.log(`Answer for remote connection\n${desc.sdp}`);

                const inboxUrl = await this.core.getInboxUrl(this.opponentWebId);
                let descLiteral = literal(JSON.stringify(desc.sdp));
                descLiteral = N3.Writer()._encodeLiteral(descLiteral);

                console.log(descLiteral);

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

  async getAnswerFromNotification(fileUrl) {
    const deferred = Q.defer();
    const rdfjsSource = await this.core.getRDFjsSourceFromUrl(fileUrl);
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

    return deferred.promise;
  }

  async getOfferFromNotification(fileUrl) {
    const deferred = Q.defer();
    const rdfjsSource = await this.core.getRDFjsSourceFromUrl(fileUrl);
    const engine = newEngine();

    console.log(fileUrl);
    console.log(rdfjsSource);

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

    return deferred.promise;
  }

  async getICECandidateFromNotification(fileUrl) {
    const deferred = Q.defer();
    const rdfjsSource = await this.core.getRDFjsSourceFromUrl(fileUrl);
    const engine = newEngine();

    console.log(fileUrl);
    console.log(rdfjsSource);

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

    return deferred.promise;
  }

  sendData(data) {
    this.sendChannel.send(data);
    console.log('Sent Data: ' + data);
  }

  closeDataChannels() {
    console.log('Closing data channels');
    this.sendChannel.close();
    console.log('Closed data channel with label: ' + this.sendChannel.label);
    this.receiveChannel.close();
    console.log('Closed data channel with label: ' + this.receiveChannel.label);
    this.localConnection.close();
    this.localConnection = null;
    console.log('Closed peer connections');
  }

  async onUserDescription(desc) {
    //     this.localConnection.setLocalDescription(desc);
    //     console.log(`Offer from localConnection\n${desc.sdp}`);
    //
    //     const inboxUrl = await this.core.getInboxUrl(this.opponentWebId);
    //     this.dataSync.sendToOpponentsInbox(inboxUrl, `[ a <http://example.org/WebRTCDescription>; <http://example.org/description> "${desc}"]`);
    //
    //     // TODO wait for answer to offer (check inbox of user)
    //     // remoteConnection.setRemoteDescription(desc);
    //     // remoteConnection.createAnswer().then(
    //     //   gotDescription2,
    //     //   onCreateSessionDescriptionError
    //     // );
  }

  onDescriptionOpponent(desc) {
    console.log(`Answer from remoteConnection\n${desc.sdp}`);
    this.localConnection.setRemoteDescription(desc);
  }

  getOtherPc(pc) {
    return (pc === localConnection) ? remoteConnection : localConnection;
  }

  getName(pc) {
    return (pc === localConnection) ? 'localPeerConnection' : 'remotePeerConnection';
  }

  onIceCandidate(pc, event) {
    this.getOtherPc(pc)
      .addIceCandidate(event.candidate)
      .then(
        () => this.onAddIceCandidateSuccess(pc),
        err => this.onAddIceCandidateError(pc, err)
      );
    console.log(`${getName(pc)} ICE candidate: ${event.candidate ? event.candidate.candidate : '(null)'}`);
  }

  onAddIceCandidateSuccess() {
    console.log('AddIceCandidate success.');
  }

  onAddIceCandidateError(error) {
    console.log(`Failed to add Ice Candidate: ${error.toString()}`);
  }

  receiveChannelCallback(event) {
    console.log('Receive Channel Callback');
    this.receiveChannel = event.channel;
    this.receiveChannel.onmessage = this.onReceiveMessageCallback;
    this.receiveChannel.onopen = this.onReceiveChannelStateChange;
    this.receiveChannel.onclose = this.onReceiveChannelStateChange;
  }

  onReceiveMessageCallback(event) {
    console.log('Received Message');
    console.log(event.data);
  }

  onSendChannelStateChange() {
    const readyState = this.sendChannel.readyState;
    console.log('Send channel state is: ' + readyState);

    if (readyState === 'open') {
      clearInterval(this.checkForICECandidateIntervalId);
      this.checkForICECandidateIntervalId = null;
    }
  }

  onReceiveChannelStateChange() {
    const readyState = this.receiveChannel.readyState;
    console.log(`Receive channel state is: ${readyState}`);
  }
}

module.exports = WebRTC;