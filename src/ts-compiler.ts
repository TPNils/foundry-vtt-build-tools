
import fs from 'fs';
import fsPromises from 'fs/promises';
import { Glob } from 'glob';
import GlobWatcher from 'glob-watcher';
import path from 'path';
import ts from 'typescript';
import { MinifyOptions, minify } from 'uglify-js';
import { Cli } from './cli.js';
import { Npm } from './npm.js';
import { appendJsExtensionTransformer } from './ts-transformers/append-js-extension-transformer.js';
import { foundryVttModuleImportTransformer } from './ts-transformers/foundry-vtt-module-import-reference.js';
import { removeTypeOnlyExportTransformer } from './ts-transformers/remove-type-only-exports.js';
import { removeTypeOnlyImportsTransformer } from './ts-transformers/remove-type-only-imports.js';

type PickRequired<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;

async function copyFileCb(inputPath: string, compilerOptions: PickRequired<ts.CompilerOptions, 'outDir' | 'rootDir'>): Promise<void> {
  let outputPath = path.join(compilerOptions.outDir, inputPath);
  await fsPromises.mkdir(path.dirname(outputPath), {recursive: true});
  const inputStream = fs.createReadStream(path.join(compilerOptions.rootDir, inputPath));
  const outputStream = fs.createWriteStream(outputPath);
  inputStream.pipe(outputStream, {end: true});
  await new Promise<void>((resolve, reject) => {
    outputStream.on('finish', resolve);
    outputStream.on('error', reject);
  });
}

const jsMapSymbol = Symbol('jsMap');
export class TsCompiler {

  public static async createTsWatch(optionsToExtend: PickRequired<ts.CompilerOptions, 'outDir' | 'rootDir'>): Promise<ts.WatchOfConfigFile<any>> {
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
    const bundles = await Npm.getBundledDependencyLocations();
    let dtsWatchers: fs.FSWatcher[] = [];
    const createProgram: ts.CreateProgram<ts.EmitAndSemanticDiagnosticsBuilderProgram> = (...args) => {
      const host = args?.[2];
      if (host) {
        host.writeFile = TsCompiler.#tsWriteFile(args[1] ?? {}, host.writeFile);
      }
      const builder = ts.createEmitAndSemanticDiagnosticsBuilderProgram(...args);
      TsCompiler.#overrideEmit(builder, () => builder.getProgram(), bundles);
      
      if (builder.getCompilerOptions().declaration) {
        const watcher = GlobWatcher([`**/*.d.ts`], {
          cwd: optionsToExtend.rootDir,
          ignoreInitial: false,
        });

        const fileCb = (inputPath: string) => copyFileCb(inputPath, optionsToExtend);
        watcher.addListener('add', fileCb);
        watcher.addListener('change', fileCb);
        watcher.addListener('unlink', fileCb);
        dtsWatchers.push(watcher);
      }

      return builder;
    }

    // Note that there is another overload for `createWatchCompilerHost` that takes
    // a set of root files.
    const host = ts.createWatchCompilerHost(
      configPath,
      optionsToExtend,
      ts.sys,
      createProgram,
      TsCompiler.#reportDiagnostic,
      function reportWatchStatusChanged(diagnostic: ts.Diagnostic) {
        console.info(ts.formatDiagnostic(diagnostic, TsCompiler.#formatHost));
      },
    );

    const watch = ts.createWatchProgram(host);
    const originalClose = watch.close;
    watch.close = function(...args: any[]) {
      for (const dtsWatcher of dtsWatchers) {
        dtsWatcher.close();
      }
      dtsWatchers = [];
      originalClose.apply(this, args);
    }

    return watch;
  }

  public static async createTsProgram(optionsToExtend: PickRequired<ts.CompilerOptions, 'outDir' | 'rootDir'>): Promise<ts.Program> {
    const configPath = ts.findConfigFile('./', ts.sys.fileExists, 'tsconfig.json');
    if (!configPath) {
      throw new Error("Could not find a valid 'tsconfig.json'.");
    }

    const commandLine = ts.getParsedCommandLineOfConfigFile(configPath, optionsToExtend, {...ts.sys, onUnRecoverableConfigFileDiagnostic: TsCompiler.#throwDiagnostic})!;
    TsCompiler.#throwDiagnostic(commandLine.errors);

    const host: ts.CompilerHost = ts.createCompilerHost(commandLine.options);
    host.writeFile = TsCompiler.#tsWriteFile(commandLine.options, ts.sys.writeFile);
    const program = ts.createProgram(commandLine.fileNames, commandLine.options, host);
    TsCompiler.#overrideEmit(program, () => program, await Npm.getBundledDependencyLocations());

    const originalEmit = program.emit;

    program.emit = function(...args) {
      const glob = new Glob([`**/*.d.ts`], {
        cwd: optionsToExtend.rootDir,
        nodir: true,
      });

      for (const file of glob.iterateSync()) {
        copyFileCb(file, optionsToExtend);
      }

      return originalEmit.apply(this, args);
    }

    return program;
  }

  static readonly #formatHost: Readonly<ts.FormatDiagnosticsHost> = {
    getCanonicalFileName: path => path,
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getNewLine: () => ts.sys.newLine
  };

  static #overrideEmit(override: {emit: ts.Program['emit']}, program: () => ts.Program, inclModules: Npm.PackageQuery[] = []) {
    const emit = override.emit;
    override.emit = function(...args: Parameters<ts.Program['emit']>) {
      for (let i = args.length; i < 5; i++) {
        args.push(undefined)
      }
      args[4] ??= {};
      const transformers = args[4];
      transformers.before ??= [];
      transformers.before.push(appendJsExtensionTransformer(program()));
      transformers.before.push(foundryVttModuleImportTransformer(program(), inclModules));
      transformers.before.push(removeTypeOnlyImportsTransformer(program()));
      transformers.before.push(removeTypeOnlyExportTransformer(program()));
      return emit(...args);
    }
  }

  static #reportDiagnostic(diagnostic: ts.Diagnostic) {
    console.error(TsCompiler.#diagnosticToString(diagnostic));
  }

  static #diagnosticToString(d: ts.Diagnostic) {
    const details = [];
    if (d.file) {
      const fullText = d.file.getFullText();
      const lineNr = fullText.substring(0, d.start).split(/\r\n|\r|\n/).length;
      const lines = fullText.split(/\r\n|\r|\n/);
      let charactersBeforeLine = fullText.substring(0, d.start).match(/\r\n|\r|\n/g)?.map(m => m.length)?.reduce((prev, curr) => prev + curr, 0) ?? 0;
      for (let i = 0; i < lineNr-1; i++) {
        charactersBeforeLine += lines[i].length;
      }
      const line = lines[lineNr-1];
      details.push(`${Cli.colors.FgGray}filename: ${Cli.colors.FgGreen}${JSON.stringify(path.relative(process.cwd(), d.file.fileName))}`);
      details.push(`${Cli.colors.FgGray}line nr: ${Cli.colors.FgYellow}${lineNr}`);
      details.push(`${Cli.colors.FgGray}line: ` + [
        Cli.colors.Reset, line.substring(0, d.start - charactersBeforeLine).trimStart(),
        Cli.colors.FgRed, Cli.colors.Underscore, line.substring(d.start - charactersBeforeLine, (d.start - charactersBeforeLine) + d.length),
        Cli.colors.Reset, line.substring((d.start - charactersBeforeLine) + d.length).trimEnd(),
      ].join(''));
    }
    details.push(`${Cli.colors.FgGray}message: ${Cli.colors.Reset}${d.messageText}`);
    return `${d.category === 0 ? 'Warning' : d.category === 1 ? 'Error' : d.category === 2 ? 'Suggestion' : 'Message'} ${Cli.colors.FgYellow}${d.code}\n${details.join('\n')
      .replace(/^\s*/mg, '  ')}`
      .replace(/$/gm, Cli.colors.Reset);
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

    throw new Error(diagnostic.map(d => TsCompiler.#diagnosticToString(d)).join('\n'))
  }

  static #tsWriteFile(compilerOptions: ts.CompilerOptions, original: ts.WriteFileCallback = ts.sys.writeFile): ts.WriteFileCallback {
    return function (...args: Parameters<ts.WriteFileCallback>) {
      return TsCompiler.#jsCompiledFromTs.call(this, compilerOptions, original, ...args);
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
      return originalWrite(filePath, fileContent, ...TsCompiler.#slice(writeArgs, 2));
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
          ...TsCompiler.#slice(writeArgs, 2),
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
    if (out.error) {
      console.error({filePath, fileContent})
      throw out.error;
    }
    originalWrite(
      filePath,
      out.code,
      ...TsCompiler.#slice(writeArgs, 2),
    );

    if (out.map && compilerOptions.sourceMap) {
      originalWrite(
        filePath + '.map',
        out.map,
        ...TsCompiler.#slice(writeArgs, 2),
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

}
