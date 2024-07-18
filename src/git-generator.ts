import { createWriteStream } from 'fs';
import { cli } from './cli';

class Generator {

  public static async cmdUsageToInterface(...commands: string[]) {
    const writeStream = createWriteStream('gitCmdUsageToInterface.ts');
    try {
      for (const cmd of commands) {
        const out = await cli.execPromise('git', cmd, '-h');
        const outString = out.stderr || out.stdout;
        const paramsToProps = new Map<string, string>();
        const usageRgx = /(?:^error.+\n)?^(usage(?:.|\n)*?)\n$/gm;
        const usage = usageRgx.exec(outString)?.[1] ?? `Usage not found: ${outString}`;

        let transformed = outString.replace(usageRgx, '')
          // put description on the same line
          .replace(/\n\s+(?!--)(?=[a-z])/g, ' ')
          // fields
          .replace(/^\s*(?:-(?<shortArgName>[a-zA-Z0-9])(?:,\s+)?)?(?:--(?:\[(?<hasTheNoOption>no-)\])?(?<longArgName>[a-z\-0-9]+))?(?:\s*=?<(?<valueName>.+?)>)?(?:\[=(?<valueType>.+?)])?\s+(?<description>.*)$/gm, (substring, shortArgName: string, hasTheNoOption: string, longArgName: string, valueName: string, valueType: string, description: string) => {
            if (!shortArgName && !longArgName) {
              return substring;
            }
            let valueTypes: string[] = [];
            {
              const set = new Set<string>();
              if (!valueName) {
                set.add('boolean');
              } else {
                if (hasTheNoOption) {
                  set.add('boolean');
                }
                set.add(valueName.includes('=') ? 'object' : 'string');
              }
              if (valueType) {
                let match: RegExpMatchArray;
                if (match = valueType.match(/^<.*>$/)) {
                  set.add('string');
                } else if (match = valueType.match(/^\((.*)\)$/)) {
                  for (const t of match[1].split('|')) {
                    set.add(`'${t}'`);
                  }
                }
              }
              valueTypes = Array.from(set);
            }

            if (hasTheNoOption) {
              paramsToProps.set(`--${hasTheNoOption}${longArgName}`, `${Generator.#toProperty(longArgName)}: false`);
            }
            if (valueTypes.length === 1 && valueTypes[0] === 'boolean') {
              if (shortArgName && longArgName) {
                paramsToProps.set(`-${shortArgName}`, `${Generator.#toProperty(longArgName)}: true`);
              } else if (shortArgName) {
                paramsToProps.set(`-${shortArgName}`, `${Generator.#toProperty(shortArgName)}: true`);
              }
              if (longArgName) {
                paramsToProps.set(`--${longArgName}`, `${Generator.#toProperty(longArgName)}: true`);
              }
            } else {
              if (shortArgName && longArgName) {
                paramsToProps.set(`-${shortArgName}`, Generator.#toProperty(longArgName));
              } else if (shortArgName) {
                paramsToProps.set(`-${shortArgName}`, Generator.#toProperty(shortArgName));
              }
              if (longArgName) {
                paramsToProps.set(`--${longArgName}`, Generator.#toProperty(longArgName));
              }
            }

            return `/** ${description} */\n${Generator.#toProperty(longArgName ?? shortArgName)}?: ${valueTypes.join(' | ')};`
          })
          // comment weirdness
          .replace(/^([a-z0-9 :-]+)$/gmi, '// $1');

        let transformedUsage = usage;
        for (const [param, prop] of paramsToProps.entries()) {
          // console.log(cmd.toLowerCase(), param, '=>', prop)
          const rgx = new RegExp(`(?<=\\s|\\[|\\()${Generator.#escapeRegExp(param)}(?![a-zA-Z0-9])`, 'g');
          transformed = transformed.replace(rgx, '`' + prop + '`');
          transformedUsage = transformedUsage.replace(rgx, '`' + prop + '`');
        }
        writeStream.write([
          `export namespace ${cmd.toLowerCase()} {\n`,
          `${transformedUsage.replace(/\s+$/m, '').replace(/^(.*)$/mg, '  /* $1 */')}\n`,
          `  export interface Options {\n`,
          `${transformed.replace(/^/mg, '    ').replace(/\s+$/m, '')}\n`,
          `  }\n`,
          `  export type Return = void;\n`,
          `}`
        ].join(''));
        writeStream.write('\n\n')
      }
    } finally {
      writeStream.close()
    }
  }

  static #toProperty(str: string): string {
    if (str.length !== 1) {
      str = Generator.#toCamelCase(str);
    }
    return str.match(/^[A-Za-z_$][\w$]*$/) ? str : `['${str.replace(/\\/g, '\\\\').replace(`'`, `\\'`)}']`
  }

  static #toCamelCase(str: string): string {
    return str.toLowerCase().replace(/[^a-z0-9]([a-z0-9])/g, (substring, char: string) => char.toUpperCase())
  }

  static #escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

}

export namespace Git {
  export namespace add {
    export interface Options {
      /** dry run */
      dryRun?: boolean;
      /** be verbose */
      verbose?: boolean;
      /** interactive picking */
      interactive?: boolean;
      /** select hunks interactively */
      patch?: boolean;
      /** edit current diff and apply */
      edit?: boolean;
      /** allow adding otherwise ignored files */
      force?: boolean;
      /** update tracked files */
      update?: boolean;
      /** renormalize EOL of tracked files (implies -u) */
      renormalize?: boolean;
      /** record only the fact that the path will be added later */
      intentToAdd?: boolean;
      /** add changes from all tracked and untracked files */
      all?: boolean;
      /** ignore paths removed in the working tree (same as --no-all) */
      ignoreRemoval?: boolean;
      /** don't add, only refresh the index */
      refresh?: boolean;
      /** just skip files which cannot be added because of errors */
      ignoreErrors?: boolean;
      /** check if - even missing - files are ignored in dry run */
      ignoreMissing?: boolean;
      /** allow updating entries outside of the sparse-checkout cone */
      sparse?: boolean;
      /** (+|-)x   override the executable bit of the listed files */
      chmod?: boolean;
      /** read pathspec from file */
      pathspecFromFile?: boolean | string;
      /** with --pathspec-from-file, pathspec elements are separated with NUL character */
      pathspecFileNul?: boolean;
    }
    export type Return = void;
  }
  export namespace clone {
    export interface Options {
      /** be more verbose */
      verbose?: boolean;
      /** be more quiet */
      quiet?: boolean;
      /** force progress reporting */
      progress?: boolean;
      /** don't clone shallow repository */
      rejectShallow?: boolean;
      /** don't create a checkout */
      noCheckout?: boolean;
      /** opposite of `noCheckout: true` */
      checkout?: boolean;
      /** create a bare repository */
      bare?: boolean;
      /** create a mirror repository (implies bare) */
      mirror?: boolean;
      /** to clone from a local repository */
      local?: boolean;
      /** don't use local hardlinks, always copy */
      noHardlinks?: boolean;
      /** opposite of `noHardlinks: true` */
      hardlinks?: boolean;
      /** setup as shared repository */
      shared?: boolean;
      /** initialize submodules in the clone */
      recursive?: boolean;
      /** number of submodules cloned in parallel */
      jobs?: boolean | string;
      /** directory from which templates will be used */
      template?: boolean | string;
      /** reference repository */
      reference?: boolean | string;
      /** reference repository */
      referenceIfAble?: boolean | string;
      /** use `reference` only while cloning */
      dissociate?: boolean;
      /** use <name> instead of 'origin' to track upstream */
      origin?: boolean | string;
      /** checkout <branch> instead of the remote's HEAD */
      branch?: boolean | string;
      /** path to git-upload-pack on the remote */
      uploadPack?: boolean | string;
      /** create a shallow clone of that depth */
      depth?: boolean | string;
      /** create a shallow clone since a specific time */
      shallowSince?: boolean | string;
      /** deepen history of shallow clone, excluding rev */
      shallowExclude?: boolean | string;
      /** clone only one branch, HEAD or `branch` */
      singleBranch?: boolean;
      /** don't clone any tags, and make later fetches not to follow them */
      noTags?: boolean;
      /** opposite of `noTags: true` */
      tags?: boolean;
      /** any cloned submodules will be shallow */
      shallowSubmodules?: boolean;
      /** separate git dir from working tree */
      separateGitDir?: boolean | string;
      /** set config inside the new repository */
      config?: boolean | {[key: string]: string};
      /** option to transmit */
      serverOption?: boolean | string;
      /** use IPv4 addresses only */
      ipv4?: boolean;
      /** use IPv6 addresses only */
      ipv6?: boolean;
      /** object filtering */
      filter?: boolean | string;
      /** apply partial clone filters to submodules */
      alsoFilterSubmodules?: boolean;
      /** any cloned submodules will use their remote-tracking branch */
      remoteSubmodules?: boolean;
      /** initialize sparse-checkout file to include only files at root */
      sparse?: boolean;
      /** a URI for downloading bundles before fetching from origin remote */
      bundleUri?: boolean | string;
    }
    export type Return = void;
  }
  export namespace init {
    export interface Options {
      template?: boolean | string;
      /** create a bare repository */
      bare?: boolean;
      /** specify that the git repository is to be shared amongst several users */
      shared?: string;
      /** be quiet */
      quiet?: boolean;
      /** separate git dir from working tree */
      separateGitDir?: boolean | string;
      /** override the name of the initial branch */
      initialBranch?: boolean | string;
      /** specify the hash algorithm to use */
      objectFormat?: boolean | string;
    }
    export type Return = void;
  }
}

export class Git {

  public static async add(dir: string = '.', options?: Git.add.Options): Promise<Git.add.Return> {
    const out = await cli.execPromise('git', 'add', dir, ...Git.#optionsToCommandParts(options as any));
    cli.throwIfError(out);
  }

  public static async clone(repo: string): Promise<Git.clone.Return>
  public static async clone(repo: string, outDir: string): Promise<Git.clone.Return>
  public static async clone(repo: string, options: Git.clone.Options): Promise<Git.clone.Return>
  public static async clone(repo: string, outDir: string, options: Git.clone.Options): Promise<Git.clone.Return>
  public static async clone(...args: [string, (string | Git.clone.Options)?, (string | Git.clone.Options)?]): Promise<Git.clone.Return> {
    const repo = args[0];
    let options: Git.clone.Options;
    let outDir: string;
    for (let i = 1; i < args.length; i++) {
      const value = args[i];
      if (typeof value === 'string') {
        outDir ??= value;
      } else {
        options ??= value;
      }
    }
    const out = await cli.execPromise('git', 'clone', ...Git.#optionsToCommandParts(options as any), repo, ...(outDir ? [outDir] : []))
    cli.throwIfError(out);
  }

  public static async init(): Promise<Git.clone.Return>
  public static async init(outDir: string): Promise<Git.clone.Return>
  public static async init(options: Git.clone.Options): Promise<Git.clone.Return>
  public static async init(outDir: string, options: Git.clone.Options): Promise<Git.clone.Return>
  public static async init(...args: [(string | Git.clone.Options)?, (string | Git.clone.Options)?]): Promise<Git.clone.Return> {
    const repo = args[0];
    let options: Git.clone.Options;
    let outDir: string;
    for (let i = 0; i < args.length; i++) {
      const value = args[i];
      if (typeof value === 'string') {
        outDir ??= value;
      } else {
        options ??= value;
      }
    }
    const out = await cli.execPromise('git', 'init', ...Git.#optionsToCommandParts(options as any), ...(outDir ? [outDir] : []))
    cli.throwIfError(out);
  }

  static #optionsToCommandParts(options?: NodeJS.Dict<boolean | string | {[key: string]: string}>): string[] {
    const parts: string[] = [];
    if (options == null) {
      return parts;
    }

    for (const [key, value] of Object.entries(options)) {
      if (value === false) {
        parts.push('--no-' + Git.#toDashCase(key));
        continue;
      }
      
      switch (typeof value) {
        case 'boolean': {
          parts.push('--' + Git.#toDashCase(key));
          break;
        }
        case 'bigint':
        case 'number': {
          parts.push('--' + Git.#toDashCase(key));
          parts.push(String(value));
          break;
        }
        case 'string': {
          parts.push('--' + Git.#toDashCase(key));
          parts.push(value);
          break;
        }
        case 'object': {
          for (const [vKey, vValue] of Object.entries(value)) {
            parts.push('--' + Git.#toDashCase(key));
            parts.push(`${vKey}=${vValue}`);
          }
          break;
        }
      }
    }

    return parts;
  }

  static #toDashCase(str: string): string {
    if (str.length === 1) {
      return str;
    }
    return str.replace(/[^a-z0-9]([a-zA-Z0-9])/g, (substring, char: string) => '-' + char.toLowerCase())
  }
}

Generator.cmdUsageToInterface(...[
  'add',
  // 'am',
  // 'archive',
  // 'bisect',
  'branch',
  // 'bundle',
  'checkout',
  // 'cherry',
  // 'citool',
  'clean',
  'clone',
  'commit',
  // 'describe',
  // 'diff',
  // 'fetch',
  // 'format',
  // 'gc',
  // 'gitk',
  // 'grep',
  // 'gui',
  'init',
  'log',
  // 'maintenance',
  // 'merge',
  // 'mv',
  // 'notes',
  'pull',
  'push',
  // 'range',
  'rebase',
  // 'reset',
  // 'restore',
  // 'revert',
  'rm',
  // 'scalar',
  // 'shortlog',
  // 'show',
  // 'sparse',
  'stash',
  'status',
  // 'submodule',
  // 'switch', // TODO reserved keyword
  // 'tag',
  // 'worktree',
].filter(cmd => !(cmd in Git)));
// Git.clone('test', 'outDir', {verbose: true, config: {'a': 'b'}, filter: 'nah'})
