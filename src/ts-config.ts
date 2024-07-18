import { getTsconfig, TsConfigJsonResolved } from 'get-tsconfig';
import * as path from 'path';
import * as fs from 'fs';
import { GlobSync } from 'glob';
import * as GlobWatcher from 'glob-watcher';
import { EventEmitter } from 'stream';

export namespace TsConfig {
  type TupleLookup<T, K> = K extends keyof T ? [K, T[K] extends any[] ? (...args: T[K])=>void : never] : never;
  type TupleFromInterface<T, K extends Array<keyof T> = Array<keyof T>> = { [I in keyof K]: TupleLookup<T, K[I]> }

  interface DefaultEventMap<T extends Record<keyof T, any[]>> {
    newListener: TupleFromInterface<T>[number];
    removeListener: TupleFromInterface<T>[number];
  }
  export interface BaseWatchEventMap {
    add: [string, fs.Stats?];
    change: [string, fs.Stats?];
    unlink: [string, fs.Stats?];
  }

  export type WatchEventMap = BaseWatchEventMap & DefaultEventMap<BaseWatchEventMap>;
}

export class TsConfig {

  public static getNonTsFiles(): string[] {
    const tsConfig = getTsconfig();
    if (!tsConfig) {
      throw new Error(`Could not find a valid 'tsconfig.json'`);
    }

    const {files, inclGlobs, exclGlobs} = TsConfig.#getIncExcl(tsConfig.config);
    
    // Should not affect tsConfig.config.files
    // https://www.typescriptlang.org/tsconfig/#exclude
    const excludeFileGlobs = new Set<string>();
    for (const glob of exclGlobs) {
      const globSync = new GlobSync(glob, {
        cwd: path.basename(tsConfig.path),
        nodir: true,
        absolute: true,
      });
      for (const file of globSync.found) {
        excludeFileGlobs.add(file);
      }
    }
    
    for (const glob of inclGlobs) {
      const globSync = new GlobSync(glob, {
        cwd: path.basename(tsConfig.path),
        nodir: true,
        absolute: true,
      });
      for (const file of globSync.found) {
        if (!excludeFileGlobs.has(file)) {
          files.add(file);
        }
      }
    }

    return TsConfig.#filterNonTsFiles(tsConfig.config, files);
  }

  public static watchNonTsFiles(): EventEmitter<TsConfig.BaseWatchEventMap> {
    const tsConfig = getTsconfig();
    if (!tsConfig) {
      throw new Error(`Could not find a valid 'tsconfig.json'`);
    }

    const {files, inclGlobs, exclGlobs} = TsConfig.#getIncExcl(tsConfig.config);


    const eventEmitter = new EventEmitter<TsConfig.WatchEventMap>({captureRejections: true});
    const listenEvents: Array<keyof TsConfig.BaseWatchEventMap> = ['add', 'change', 'unlink'];

    let watcher: fs.FSWatcher;
    let listeners = 0;
    eventEmitter.on('newListener', (event, fn) => {
      if (!listenEvents.includes(event)) {
        return;
      }
      if (watcher == null) {
        watcher = GlobWatcher([
          ...Array.from(inclGlobs),
          ...Array.from(exclGlobs).map(excl => `!${excl}`),
          ...Array.from(files),
          ...TsConfig.#getTsExtensions(tsConfig.config).map(ext => `!**/*${ext}`),
        ], {
          cwd: path.dirname(tsConfig.path),
          ignoreInitial: false,
        });

        watcher.addListener('add', (...args: [string]) => eventEmitter.emit('add', ...args));
        watcher.addListener('change', (...args: [string]) => eventEmitter.emit('change', ...args));
        watcher.addListener('unlink', (...args: [string]) => eventEmitter.emit('unlink', ...args));
      }
      listeners++;
    })

    eventEmitter.on('removeListener', (event, fn) => {
      if (!listenEvents.includes(event)) {
        return;
      }
      listeners--;
      if (listeners === 0) {
        watcher.close();
      }
    })
    
    return eventEmitter as any;
  }

  static #getIncExcl(tsConfig: TsConfigJsonResolved): {files: Set<string>; inclGlobs: Set<string>; exclGlobs: Set<string>;} {
    const files = new Set<string>();
    const inclGlobs = new Set<string>();
    const exclGlobs = new Set<string>();

    if (!tsConfig.files?.length && !tsConfig.include) {
      // Default include value
      inclGlobs.add('**/*');
    }
    for (const file of tsConfig.files ?? []) {
      files.add(path.resolve(process.cwd(), file));
    }
    for (const include of tsConfig.include ?? []) {
      inclGlobs.add(include);
    }
    if (tsConfig.exclude) {
      for (const excl of tsConfig.exclude) {
        exclGlobs.add(excl);
      }
    } else {
      // Default exclude value
      exclGlobs.add('node_modules');
      exclGlobs.add('bower_components');
      exclGlobs.add('jspm_packages');
      if (tsConfig.compilerOptions?.outDir) {
        exclGlobs.add(tsConfig.compilerOptions.outDir)
      }
    }

    return {
      files,
      inclGlobs,
      exclGlobs,
    }
  }

  static #filterNonTsFiles(tsConfig: TsConfigJsonResolved, files: Iterable<string>): string[] {
    // https://www.typescriptlang.org/tsconfig/#include
    const excludeExtensions = TsConfig.#getTsExtensions(tsConfig);
    const filteredFiles: string[] = [];
    fileLoop: for (const file of files) {
      const lowerFile = file.toLowerCase();
      for (const ext of excludeExtensions) {
        if (lowerFile.endsWith(ext)) {
          continue fileLoop;
        }
      }
      filteredFiles.push(file);
    }

    return filteredFiles;
  }

  static #getTsExtensions(tsConfig: TsConfigJsonResolved): string[] {
    const excludeExtensions = ['.ts', '.tsx', '.d.ts'];
    if (tsConfig.compilerOptions?.allowJs) {
      excludeExtensions.push('.js', '.jsx');
    }
    return excludeExtensions;
  }

}