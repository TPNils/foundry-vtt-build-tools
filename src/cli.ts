
import { ExecException, spawn, SpawnOptions } from 'child_process';
import { Writable } from 'stream';

export interface ExecResponse {
  cmd: string;
  args: string[];
  stdout?: string;
  stderr?: string;
  err?: ExecException;
};

export class Cli {

  public static execPromise(command: string, args: string[] = [], options: Omit<SpawnOptions, 'shell'> = {}): Promise<ExecResponse> {
    const externalStack = new Error().stack!.replace(/^.*\n/, '');
    return new Promise<ExecResponse>(async (resolve, reject) => {
      const response: ExecResponse = {
        cmd: command,
        args: args,
        stdout: '',
        stderr: '',
      };
      const child = spawn(command, args, {...options, shell: true});
      child.stdout.pipe(new Writable({write: (chunk, encoding, callback) => {
        if (chunk instanceof Buffer) {
          response.stdout += chunk.toString();
        } else {
          response.stdout += chunk;
        }
        callback();
      }}));
      child.stderr.pipe(new Writable({write: (chunk, encoding, callback) => {
        if (chunk instanceof Buffer) {
          response.stderr += chunk.toString();
        } else {
          response.stderr += chunk;
        }
        callback();
      }}));
      child.on('error', err => {
        err.stack = err.message + '\n' + externalStack;
        response.err = err;
      });
      child.on('close', (code, signal) => {
        if (signal) {
          const err = new Error(`${command} was killed with signal ` + signal);
          err.stack = err.message + '\n' + externalStack;
          response.err = err;
        } else if (code) {
          const err = new Error(`${command} exited with code ${code}.`)
          err.stack = err.message + '\n' + externalStack;
          response.err = err;
        }
        resolve(response);
      });
    })
  }

  public static throwIfError(cmd: ExecResponse, options: {ignoreOut?: boolean} = {}): void {
    if (cmd.err) {
      throw cmd.err;
    }
    if (cmd.stderr && !options.ignoreOut) {
      throw new Error(`${cmd.cmd} ${cmd.args.join(' ')} threw an error: ${cmd.stderr}`);
    }
  }

  public static readonly colors = Object.freeze({
    Reset: "\x1b[0m",
    Bright: "\x1b[1m",
    Dim: "\x1b[2m",
    Underscore: "\x1b[4m",
    Blink: "\x1b[5m",
    Reverse: "\x1b[7m",
    Hidden: "\x1b[8m",
    FgBlack: "\x1b[30m",
    FgRed: "\x1b[31m",
    FgGreen: "\x1b[32m",
    FgYellow: "\x1b[33m",
    FgBlue: "\x1b[34m",
    FgMagenta: "\x1b[35m",
    FgCyan: "\x1b[36m",
    FgWhite: "\x1b[37m",
    FgGray: "\x1b[90m",
    BgBlack: "\x1b[40m",
    BgRed: "\x1b[41m",
    BgGreen: "\x1b[42m",
    BgYellow: "\x1b[43m",
    BgBlue: "\x1b[44m",
    BgMagenta: "\x1b[45m",
    BgCyan: "\x1b[46m",
    BgWhite: "\x1b[47m",
    BgGray: "\x1b[100m",
  });


}