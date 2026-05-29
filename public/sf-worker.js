// sf-worker.js — robust Emscripten Stockfish bridge

self.print = function (line) {
  postMessage(line);
};

self.printErr = function (_line) {
  // suppress noisy stderr
};

try {
  importScripts("/stockfish.js");

  // engine installs its own onmessage
  const engineHandler = self.onmessage;

  self.onmessage = function (e) {
    if (engineHandler) engineHandler.call(self, e);
  };

  // initialize UCI
  self.onmessage(new MessageEvent("message", { data: "uci" }));
  self.onmessage(new MessageEvent("message", { data: "isready" }));
  self.onmessage(new MessageEvent("message", { data: "ucinewgame" }));
} catch (err) {
  postMessage("SF_INIT_FAILED");
}
