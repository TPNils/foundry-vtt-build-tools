
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import * as chalk from 'chalk';
import * as ts from 'typescript';
import * as open from 'open';

import { exec } from 'child_process';
import { MinifyOptions, minify } from 'uglify-js';
import { buildMeta } from './build-meta';
import { args } from './args';
import { Git } from './git';
import { FoundryVTT } from './foundy-vtt';
import { Version } from './version';

const jsMapSymbol = Symbol('jsMap');

class BuildActions {

  public static async createTsWatch() {
    const configPath = ts.findConfigFile('./', ts.sys.fileExists, 'tsconfig.json');
    if (!configPath) {
      throw new Error("Could not find a valid 'tsconfig.json'.");
    }

    // TypeScript can use several different program creation "strategies":
    //  * ts.createEmitAndSemanticDiagnosticsBuilderProgram,
    //  * ts.createSemanticDiagnosticsBuilderProgram
    //  * ts.createAbstractBuilder
    // The first two produce "builder programs". These use an incremental strategy
    // to only re-check and emit files whose contents may have changed, or whose
    // dependencies may have changes which may impact change the result of prior
    // type-check and emit.
    // The last uses an ordinary program which does a full type check after every
    // change.
    // Between `createEmitAndSemanticDiagnosticsBuilderProgram` and
    // `createSemanticDiagnosticsBuilderProgram`, the only difference is emit.
    // For pure type-checking scenarios, or when another tool/process handles emit,
    // using `createSemanticDiagnosticsBuilderProgram` may be more desirable.
    const createProgram: ts.CreateProgram<ts.EmitAndSemanticDiagnosticsBuilderProgram> = (...args) => {
      const host = args?.[2];
      if (host) {
        host.writeFile = BuildActions.#tsWriteFile(args[1] ?? {}, host.writeFile)
      }
      return ts.createEmitAndSemanticDiagnosticsBuilderProgram(...args)
    }

    // Note that there is another overload for `createWatchCompilerHost` that takes
    // a set of root files.
    const host = ts.createWatchCompilerHost(
      configPath,
      {},
      ts.sys,
      createProgram,
      BuildActions.#reportDiagnostic,
      function reportWatchStatusChanged(diagnostic: ts.Diagnostic) {
        console.info(ts.formatDiagnostic(diagnostic, BuildActions.#formatHost));
      },
    );

    return ts.createWatchProgram(host);
  }

  public static async createTsProgram() {
    const configPath = ts.findConfigFile('./', ts.sys.fileExists, 'tsconfig.json');
    if (!configPath) {
      throw new Error("Could not find a valid 'tsconfig.json'.");
    }

    const commandLine = ts.getParsedCommandLineOfConfigFile(configPath, {}, {...ts.sys, onUnRecoverableConfigFileDiagnostic: BuildActions.#throwDiagnostic})!;
    BuildActions.#throwDiagnostic(commandLine.errors);

    const host: ts.CompilerHost = ts.createCompilerHost(commandLine.options);
    host.writeFile = BuildActions.#tsWriteFile(commandLine.options, host.writeFile);
    const program = ts.createProgram(commandLine.fileNames, commandLine.options, host);

    return program.emit()
  }

  static readonly #formatHost: Readonly<ts.FormatDiagnosticsHost> = {
    getCanonicalFileName: path => path,
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getNewLine: () => ts.sys.newLine
  };

  static #reportDiagnostic(diagnostic: ts.Diagnostic) {
    console.error('Error', diagnostic.code, ':', ts.flattenDiagnosticMessageText(diagnostic.messageText, BuildActions.#formatHost.getNewLine()));
  }

  static #throwDiagnostic(diagnostic?: ts.Diagnostic | ts.Diagnostic[]) {
    if (!diagnostic) {
      return;
    }
    if (!Array.isArray(diagnostic)) {
      diagnostic = [diagnostic];
    }
    if (diagnostic.length === 0) {
      return;
    }

    throw new Error(diagnostic.map(d => `Error ${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, BuildActions.#formatHost.getNewLine())}`).join('\n'))
  }

  static #tsWriteFile(compilerOptions: ts.CompilerOptions, original: ts.WriteFileCallback = ts.sys.writeFile): ts.WriteFileCallback {
    return function (...args: Parameters<ts.WriteFileCallback>) {
      return BuildActions.#jsCompiledFromTs.call(this, compilerOptions, original, ...args);
    }
  }

  static #jsCompiledFromTs(this: ts.CompilerHost, compilerOptions: ts.CompilerOptions, originalWrite: ts.WriteFileCallback, ...writeArgs: Parameters<ts.WriteFileCallback>): void {
    const [filePath, fileContent, writeByteOrderMark, onError, tsSources] = writeArgs;
    if (filePath.endsWith('.js.map')) {
      // Keep in memory for later use
      this[jsMapSymbol] ??= {};
      this[jsMapSymbol][filePath] = writeArgs;
      return;
    }
    if (!filePath.endsWith('.js')) {
      return originalWrite(filePath, fileContent, ...BuildActions.#slice(writeArgs, 2));
    }
    const parsedFilePath = path.parse(filePath);
    const minifyOptions: MinifyOptions = {
      compress: {
        // Creates correcter source mapping
        conditionals: false,
        if_return: false,
      }
    };
    if (compilerOptions.inlineSourceMap) {
      minifyOptions.sourceMap = {
        content: 'inline',
        url: 'inline',
      }
    } else if (compilerOptions.sourceMap) {
      const [mapFilePath, mapFileContent] = this[jsMapSymbol][filePath + '.map'];
      minifyOptions.sourceMap = {
        content: JSON.parse(mapFileContent),
        url: `./${path.basename(mapFilePath)}`,
      }
    }
    
    if (compilerOptions.inlineSources != null && (typeof minifyOptions.sourceMap === 'object')) {
      minifyOptions.sourceMap.includeSources = compilerOptions.inlineSources;
    }

    if ((typeof minifyOptions.sourceMap === 'object') && !minifyOptions.sourceMap?.includeSources) {
      for (const tsSource of tsSources ?? []) {
        originalWrite(
          path.join(parsedFilePath.dir, path.basename(tsSource.fileName)),
          tsSource.getFullText(),
          ...BuildActions.#slice(writeArgs, 2),
        );
      }
      if (minifyOptions.sourceMap.content === 'inline') {
        const base64 = /^[ \t\v]*\/\/[ \t\v]*#[ \t\v]*sourceMappingURL=(?=data:application\/json)(?:.*?);base64,(.*)$/m.exec(fileContent)?.[1];
        if (base64) {
          minifyOptions.sourceMap.content = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
        }
      }
      if (typeof minifyOptions.sourceMap.content === 'object') {
        minifyOptions.sourceMap.content.sources = (tsSources ?? []).map(ts => path.basename(ts.fileName));
      }
    }

    const out = minify(fileContent, minifyOptions);

    originalWrite(
      filePath,
      out.code,
      ...BuildActions.#slice(writeArgs, 2),
    );

    if (out.map && compilerOptions.sourceMap) {
      originalWrite(
        filePath + '.map',
        out.map,
        ...BuildActions.#slice(writeArgs, 2),
      );
    }
    
    if (this[jsMapSymbol] && filePath + '.map' in this[jsMapSymbol]) {
      delete this[jsMapSymbol][filePath + '.map'];
    }
  }

  static #slice<T extends any[]>(array: T, from: 1): ((...args: T) => void) extends (a: any, ...rest: infer R) => any ? R : [];
  static #slice<T extends any[]>(array: T, from: 2): ((...args: T) => void) extends (a: any, b: any, ...rest: infer R) => any ? R : [];
  static #slice<T extends any[]>(array: T, from: 3): ((...args: T) => void) extends (a: any, b: any, c: any, ...rest: infer R) => any ? R : [];
  static #slice<T extends any[]>(array: T, from: 4): ((...args: T) => void) extends (a: any, b: any, c: any, d: any, ...rest: infer R) => any ? R : [];
  static #slice<T extends any[]>(array: T, from: 5): ((...args: T) => void) extends (a: any, b: any, c: any, d: any, e: any, ...rest: infer R) => any ? R : [];
  static #slice<T extends any[]>(array: T, from: number): ReturnType<T['slice']> {
    return array.slice(from) as any;
  }

  private static startFoundry() {
    if (!FoundryVTT.runConfigExists()) {
      console.warn('Could not start foundry: foundryconfig.json not found in project root');
      return;
    }
    const configs = args.getFoundryInstanceName() == null ? FoundryVTT.getRunConfigs() : [FoundryVTT.getRunConfig(args.getFoundryInstanceName()!)];
    for (const config of configs) {
      const cmd = `node "${path.join(config.foundryPath, 'resources', 'app', 'main.js')}" --dataPath="${config.dataPath}"`;
      console.log('starting foundry: ', cmd)
      const childProcess = exec(cmd);
  
      let serverStarted = false;
      childProcess.stdout!.on('data', function (data) {
        process.stdout.write(data.replace(/^(foundryvtt)?/i, `$1 ${config.runInstanceKey}`));
        if (!serverStarted) {
          const result = /Server started and listening on port ([0-9]+)/i.exec(data.toString());
          if (result) {
            open(`http://localhost:${result[1]}/game`);
          }
        }
      });
      
      childProcess.stderr!.on('data', function (data) {
        process.stderr.write(data.replace(/^(foundryvtt)?/i, `$1 ${config.runInstanceKey}`));
      });
    }
  }

}

export async function compileReadme() {
  const html = await FoundryVTT.markdownToHtml(fs.readFileSync('./README.md', 'utf8'));
  fs.writeFileSync('./README.html', html, 'utf8');
}

export async function manifestForGithubCurrentVersion() {
  const manifest = FoundryVTT.readManifest(buildMeta.getSrcPath());
  await Git.setGithubLinks(manifest.manifest, false);
  await FoundryVTT.writeManifest(manifest, {injectCss: true, injectHbs: true, injectOlderVersionProperties: true});
}

export async function manifestForGithubLatestVersion() {
  const manifest = FoundryVTT.readManifest(buildMeta.getSrcPath());
  await Git.setGithubLinks(manifest.manifest, true);
  await FoundryVTT.writeManifest(manifest, {injectCss: true, injectHbs: true, injectOlderVersionProperties: true});
}

export async function rePublish() {
  const currentVersion = await Git.getLatestVersionTag();
  await Git.deleteVersionTag(currentVersion);
  await Git.tagCurrentVersion(currentVersion);
}

export async function publish() {
  await args.validateVersion();
  await Git.validateCleanRepo();

  const manifest = FoundryVTT.readManifest(buildMeta.getSrcPath());
  const newVersion = args.getNextVersion(await Git.getLatestVersionTag());
  manifest.manifest.version = Version.toString(newVersion);
  await Git.setGithubLinks(manifest.manifest, false);
  await FoundryVTT.writeManifest(manifest, {injectCss: true, injectHbs: true, injectOlderVersionProperties: true});

  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  packageJson.version = manifest.manifest.version;
  fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2), 'utf8');

  await Git.commitNewVersion(newVersion);
  await Git.push();
  // If for some reason the tag already exists
  await Git.deleteVersionTag(newVersion);
  await Git.tagCurrentVersion(newVersion);
}

async function start() {
  console.log(await BuildActions.createTsWatch())
}
start();