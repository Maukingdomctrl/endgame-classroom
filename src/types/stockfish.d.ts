declare module "stockfish" {
  type Engine = {
    postMessage: (command: string) => void;
    onmessage: ((event: MessageEvent<string>) => void) | null;
    terminate?: () => void;
  };

  const Stockfish: () => Engine;
  export default Stockfish;
}
