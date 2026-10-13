/**
 * What the bench asks a person at the terminal: a passphrase or an API key typed without echo,
 * a line, or a yes. The terminal is the only way such a secret enters the bench: never the
 * environment, never the command line. A test stands in a scripted prompter.
 */
import readline from "node:readline/promises";

/** Thrown when a secret is asked for and there is no terminal to type it at. */
export class NoTerminal extends Error {}

export interface Prompter {
  /** A line, echoed as typed. */
  ask(question: string): Promise<string>;
  /** A line typed without echo; throws NoTerminal without a terminal. */
  hidden(question: string): Promise<string>;
  /** A yes or no; no without a terminal. */
  confirm(question: string): Promise<boolean>;
}

/** The person at this process's terminal. */
export function ttyPrompter(): Prompter {
  return {
    async ask(question) {
      if (!process.stdin.isTTY) throw new NoTerminal("A terminal is needed to answer.");
      const prompt = readline.createInterface({ input: process.stdin, output: process.stderr });
      try {
        return (await prompt.question(question)).trim();
      } finally {
        prompt.close();
      }
    },
    hidden: askHidden,
    async confirm(question) {
      if (!process.stdin.isTTY) return false;
      const prompt = readline.createInterface({ input: process.stdin, output: process.stderr });
      try {
        return /^y(es)?$/i.test((await prompt.question(question)).trim());
      } finally {
        prompt.close();
      }
    },
  };
}

/** Reads a line at the terminal without echoing it. */
function askHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY)
    return Promise.reject(new NoTerminal("A secret is typed at a terminal: run the bench in one."));
  process.stderr.write(question);
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const done = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write("\n");
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          done();
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          done();
          reject(new NoTerminal("Cancelled."));
          return;
        }
        value = char === "\u007f" || char === "\b" ? value.slice(0, -1) : value + char;
      }
    };
    stdin.on("data", onData);
  });
}
