// Emscripten Stockfish writes output via self.print
// and reads UCI commands via its own internal onmessage.
// We intercept print and forward to the main thread.

self.print = (line) => {
  postMessage(line);
};

self.printErr = (line) => {
  // Suppress noisy stderr unless you want it
  // postMessage('[ERR] ' + line);
};

// Load the engine — it auto-starts, no factory call needed
importScripts('/stockfish.js');

// Forward main-thread commands into the engine's stdin
// Emscripten builds expose this as self.postMessage internally,
// but the correct external API is to just re-set onmessage after load:
const engineOnMessage = self.onmessage; // grab what stockfish.js installed

self.onmessage = (e) => {
  if (engineOnMessage) engineOnMessage(e);
};
// Kick off UCI handshake explicitly
const evt = new MessageEvent('message', { data: 'uci' });
self.dispatchEvent(evt);
