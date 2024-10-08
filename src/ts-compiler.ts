
import path from 'path';
import ts from 'typescript';
import { MinifyOptions, minify } from 'uglify-js';
import { Npm } from './npm.js';
import { appendJsExtensionTransformer } from './ts-transformers/append-js-extension-transformer.js';
import { foundryVttModuleImportTransformer } from './ts-transformers/foundry-vtt-module-import-reference.js';
import { removeTypeOnlyExportTransformer } from './ts-transformers/remove-type-only-exports.js';
import { removeTypeOnlyImportsTransformer } from './ts-transformers/remove-type-only-imports.js';

const jsMapSymbol = Symbol('jsMap');

export class TsCompiler {

  public static async createTsWatch(optionsToExtend: ts.CompilerOptions = {}): Promise<ts.WatchOfConfigFile<any>> {
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
    const createProgram: ts.CreateProgram<ts.EmitAndSemanticDiagnosticsBuilderProgram> = (...args) => {
      const host = args?.[2];
      if (host) {
        host.writeFile = TsCompiler.#tsWriteFile(args[1] ?? {}, host.writeFile);
      }
      const builder = ts.createEmitAndSemanticDiagnosticsBuilderProgram(...args);
      TsCompiler.#overrideEmit(builder, () => builder.getProgram(), bundles);
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

    return ts.createWatchProgram(host);
  }

  public static async createTsProgram(optionsToExtend: ts.CompilerOptions = {}): Promise<ts.Program> {
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
    console.error('Error', diagnostic.code, ':', ts.flattenDiagnosticMessageText(diagnostic.messageText, TsCompiler.#formatHost.getNewLine()));
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

    throw new Error(diagnostic.map(d => `Error ${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, TsCompiler.#formatHost.getNewLine())}`).join('\n'))
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
