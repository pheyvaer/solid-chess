const chessOnto = 'http://purl.org/NET/rdfchess/ontology/';
const xsd = 'http://www.w3.org/2001/XMLSchema#';
const uniqid = require('uniqid');

class SemanticChess {

  /*
    @url the unique url of this chess game
    @dataURL the url of the current user's data file where the chess data is stored
    @initStore the N3 store contains the RDF triples on which the chess game needs to be reconstructed
  */
  constructor(url, dataURL, initStore) {
    this.url;

    if (initStore) {
      processInitStore(initStore);
    } else {
      this.lastMove = null;
    }
  }

  /*
    Updates the last moves and returns the corresponding RDF
  */
  addMove(san) {
    //generate URL for move
    const moveURL = this.dataURL + `#` + uniqid();

    let sparqlUpdate = 'INSERT DATA {';

    sparqlUpdate +=
    `<${this.url}> ${chessOnto}hasHalfMove <${moveURL}>.
    
    <${moveURL} <${rdf}type> ${chessOnto}HalfMove;
      ${chessOnto}hasSANRecord "${san}"^^${xsd}string.`;

    if (this.lastMove) {
      sparqlUpdate += `<${this.lastMove.url}> ${chessOnto}nextHalfMove <${moveURL}>.`;
    }

    this.lastMove = {
      url: moveURL,
      san
    }
  }

  /*
    Generates a hash for the current state of the chess game
  */
  _generateHash() {

  }

  /*
    Process initialization store. This will fill up the game based on an N3 Store with the Chess triples.
    This method will also validate the hashes.
  */
  processInitStore(initStore) {

  }
}
