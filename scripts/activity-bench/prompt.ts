/**
 * What the bench asks a person at the terminal: a passphrase or an API key typed without echo,
 * a line, or a yes. The terminal is the only way such a secret enters the bench: never the
 * environment, never the command line. A test stands in a scripted prompter.
 */
import readline from "node:readline/promises";

/** Thrown when a secret is asked for and there is no terminal to type it at, or it ends. */
export class NoTerminal extends Error {}

export interface Prompter {
  /** A line, echoed as typed. */
  ask(question: string): Promise<string>;
  /** A line typed without echo; throws NoTerminal without a terminal, or when it ends first. */
  hidden(question: string): Promise<string>;
  /** A yes or no; no without a terminal. */
  confirm(question: string): Promise<boolean>;
}

/** The part of a terminal's input a hidden line is read from. */
export interface HiddenInput {
  isTTY?: boolean;
  setRawMode(mode: boolean): unknown;
  setEncoding(encoding: BufferEncoding): unknown;
  resume(): unknown;
  pause(): unknown;
  on(event: "data", listener: (chunk: string) => void): unknown;
  on(event: "end" | "close", listener: () => void): unknown;
  off(event: "data", listener: (chunk: string) => void): unknown;
  off(event: "end" | "close", listener: () => void): unknown;
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
    hidden: (question) => hiddenFrom(question, process.stdin, process.stderr),
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

/**
 * Reads a line from a terminal's input without echoing it. Ends — Ctrl-C, Ctrl-D, Ctrl-Z, or
 * the input closing — refuse rather than wait for ever.
 */
export function hiddenFrom(
  question: string,
  stdin: HiddenInput,
  out: { write(text: string): unknown },
): Promise<string> {
  if (!stdin.isTTY)
    return Promise.reject(new NoTerminal("A secret is typed at a terminal: run the bench in one."));
  out.write(question);
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const done = () => {
      stdin.off("data", onData);
      stdin.off("end", onEnd);
      stdin.off("close", onEnd);
      stdin.setRawMode(false);
      stdin.pause();
      out.write("\n");
    };
    const onEnd = () => {
      done();
      reject(new NoTerminal("The terminal's input ended before a line was typed."));
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
        if (char === "\u0004" || char === "\u001a") {
          onEnd();
          return;
        }
        value = char === "\u007f" || char === "\b" ? value.slice(0, -1) : value + char;
      }
    };
    stdin.on("data", onData);
    stdin.on("end", onEnd);
    stdin.on("close", onEnd);
  });
}
