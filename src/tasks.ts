import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import sass from 'sass';

import { compilePack, extractPack } from '@foundryvtt/foundryvtt-cli';
import { ChildProcess } from 'child_process';
import { glob } from 'glob';
import { Git } from './git.js';
import { FoundryVTT } from './foundy-vtt.js';
import { Version } from './version.js';
import { TsCompiler } from './ts-compiler.js';
import { TsConfig } from './ts-config.js';
import { Npm } from './npm.js';
import archiver from 'archiver';

const manifestWriteOptions: FoundryVTT.Manifest.WriteOptions = {
  injectCss: true,
  injectHbs: true,
  injectOlderVersionProperties: true,
}

export function findMostCommonDir(files: Iterable<string>): string {
  const dirs = new Set<string>();
  for (const file of files) {
    dirs.add(path.dirname(file));
  }

  let mostCommonDir: string | null = null;
  for (const dir of dirs) {
    mostCommonDir = dir;
    break;
  }
  if (mostCommonDir == null) {
    return '';
  }

  for (const dir of dirs) {
    const maxLength = Math.min(mostCommonDir.length, dir.length);
    let lastCommonCharIndex = 0;
    for (; lastCommonCharIndex < maxLength; lastCommonCharIndex++) {
      if (mostCommonDir[lastCommonCharIndex] !== dir[lastCommonCharIndex]) {
        break;
      }
    }
    mostCommonDir = mostCommonDir.substring(0, lastCommonCharIndex);
  }

  try {
    return fs.statSync(mostCommonDir)?.isDirectory() ? mostCommonDir : path.dirname(mostCommonDir)
  } catch {
    // File does not exist
    return path.dirname(mostCommonDir);
  }
}

async function cleanDir(dir: string): Promise<void> {
  const promises: Promise<any>[] = [];
  for (const file of await fsPromises.readdir(dir)) {
    promises.push(fsPromises.rm(path.join(dir, file), {recursive: true}));
  }
  await Promise.all(promises);
}

async function processFile(inputPath: string, outDir: string, rootDir: string): Promise<void> {
  let outputPath = targetOutputFile(inputPath, outDir, rootDir);
  const ext = path.extname(inputPath).toLowerCase();
  switch (ext) {
    case '.sass':
    case '.scss': {
      outputPath = outputPath.replace(/\.s[ac]ss$/i, '.css');
      break;
    }
  }

  // If file is deleted, delete output
  if (!fs.existsSync(inputPath)) {
    if (fs.existsSync(outputPath)) {
      await fsPromises.rm(outputPath, {recursive: true});
    }
    return;
  }

  switch (path.basename(inputPath)) {
    case 'module.json':
    case 'system.json': {
      const manifest = FoundryVTT.readManifest(inputPath);
      FoundryVTT.writeManifest({...manifest, filePath: outputPath}, manifestWriteOptions);
      return;
    }
  }

  switch (ext) {
    case '.sass':
    case '.scss': {
      const compileResult = await sass.compileAsync(inputPath);
      await fsPromises.mkdir(path.dirname(outputPath), {recursive: true});
      await fsPromises.writeFile(outputPath, compileResult.css);
      break;
    }
    // case '.less': {
    //   // TODO
    //   throw new Error('TODO less compiler not supported yet')
    // }
    default: {
      await fsPromises.mkdir(path.dirname(outputPath), {recursive: true});
      const inputStream = fs.createReadStream(inputPath);
      const outputStream = fs.createWriteStream(outputPath);
      inputStream.pipe(outputStream, {end: true});
      await new Promise<void>((resolve, reject) => {
        outputStream.on('finish', resolve);
        outputStream.on('error', reject);
      });
    }
  }
}

function targetOutputFile(inputPath: string, outDir: string, rootDir: string): string {
  return path.join(outDir, path.relative(rootDir, inputPath));
}

async function copyBundledDependencyLocations(outDir: string): Promise<void> {
  const sources = await Npm.getBundledDependencyLocations();
  const promises: Promise<void>[] = [];

  for (const src of sources) {
    const srcOutDir = path.join(outDir, 'node_modules', src.name);
    promises.push(glob(path.posix.join(src.location, '**/*'), {nodir: true, follow: true}).then(async files => {
      const filePromises: Promise<void>[] = [];

      const srcLocation = src.location.split(path.posix.sep).join(path.sep);
      for (const file of files) {
        const outFile = path.join(srcOutDir, file.substring(srcLocation.length));
        await fsPromises.mkdir(path.dirname(outFile), {recursive: true});
        filePromises.push(fsPromises.copyFile(file, outFile));
      }

      await Promise.all(filePromises);
    }))
  }

  await Promise.all(promises);
}

export function preBuildValidation() {
  // Pre-build validation
  const tsConfig = TsConfig.getTsConfig();
  const outDir = path.resolve(path.dirname(tsConfig.path), tsConfig.config.compilerOptions?.outDir ?? 'dist');
  const allFiles = TsConfig.getAllFiles(tsConfig);
  const rootDir = tsConfig.config.compilerOptions?.rootDir ?? findMostCommonDir(allFiles);
  const inputFilesInOutDir: string[] = [];
  for (const file of allFiles) {
    if (file.startsWith(outDir)) {
      inputFilesInOutDir.push(file);
    }
  }
  if (inputFilesInOutDir.length > 0) {
    throw new Error(`No input files are allowed in the output dir.\nOutput dir:${outDir}\nConflicting input files:${inputFilesInOutDir.map(f => `\n- ${f}`)}`)
  }

  return {tsConfig, outDir, rootDir};
}

// TODO build & watch should support nedb
// TODO copy bundled foundry manifest fields to the main one (scripts, autors, dependancies, etc...)
export async function build(outDir?: string): Promise<void> {
  // Pre-build validation
  const {tsConfig, outDir: tsOutDir, rootDir} = preBuildValidation();
  if (!outDir) {
    outDir = tsOutDir;
  }

  // Pre-build preparation
  const manifest = FoundryVTT.readManifest(rootDir, {nullable: true});
  await fsPromises.mkdir(outDir, {recursive: true});
  await cleanDir(outDir);
  const packs = new Set<string>();
  if (manifest) {
    const manifestDir = path.dirname(manifest.filePath);
    for (const pack of manifest?.manifest?.packs ?? []) {
      packs.add(path.resolve(manifestDir, pack.path));
    }
  }

  // Exec build
  await copyBundledDependencyLocations(outDir);
  (await TsCompiler.createTsProgram({rootDir, outDir})).emit();
  await Promise.all(TsConfig.getNonTsFiles(tsConfig).map(file => {
    if (packs.has(file)) {
      return;
    }
    for (const excl of packs) {
      if (file.startsWith(excl)) {
        return;
      }
    }
    return processFile(file, outDir!, rootDir);
  }));
  for (const pack of packs) {
    try {
      compilePack(pack, targetOutputFile(pack, outDir, path.dirname(manifest.filePath)));
    } catch {}
  }
  if (manifest) {
    // Process again now that all other files are present
    await processFile(manifest.filePath, outDir, rootDir);
  }
}

export async function buildZip(): Promise<void> {
  await fsPromises.mkdir(path.join('package', 'content'), {recursive: true});
  
  // TODO build should directly write to the zip
  await build(path.join('package', 'content'));
  
  const archive = archiver('zip');
  archive.pipe(fs.createWriteStream(path.join('package', 'module.zip')));
  archive.directory(path.join('package', 'content'), false);
  await archive.finalize();
  await fsPromises.rm(path.join('package', 'content'), {recursive: true});
}

export async function watch(outDir?: string): Promise<{stop: () => void}> {
  // Pre-watch validation
  const {tsConfig, outDir: tsOutDir, rootDir} = preBuildValidation();
  if (!outDir) {
    outDir = tsOutDir;
  }

  // Pre-watch preparation
  const stoppables: Array<{stop: () => void}> = [];
  const srcManifest = FoundryVTT.readManifest(rootDir, {nullable: true});
  const srcManifestDir = srcManifest == null ? null : path.dirname(srcManifest.filePath);
  await fsPromises.mkdir(outDir, {recursive: true});
  await cleanDir(outDir);
  const packPathsRelativeToTsconfig = new Set<string>();
  const packManifestPaths = new Set<string>();
  if (srcManifest) {
    const manifestDir = path.dirname(srcManifest.filePath);
    for (const pack of srcManifest?.manifest?.packs ?? []) {
      packPathsRelativeToTsconfig.add(path.relative(path.dirname(tsConfig.path), path.resolve(manifestDir, pack.path)));
      packManifestPaths.add(pack.path);
    }
  }
  
  // Find a matching foundry server
  let foundryRunConfig: FoundryVTT.RunConfig;
  if (srcManifest) {
    for (const fConfig of FoundryVTT.getRunConfigs()) {
      if (outDir!.includes(path.normalize(fConfig.dataPath))) {
        foundryRunConfig = fConfig;
        break;
      }
    }
  }

  // If it's a foundry server, copy the packs once (can't edit while the server is running)
  if (foundryRunConfig) {
    for (const pack of packManifestPaths) {
      try {
        await compilePack(path.join(srcManifestDir, pack), path.join(outDir, pack));
      } catch {}
    }
  }
  // TODO if it's not a foundry server, we can watch & compile packs

  // One-time build actions
  await copyBundledDependencyLocations(outDir);

  // Exec watch
  const fileCb = (file: string) => {
    // If it's a foundry server, don't update packs while the server runs
    if (foundryRunConfig) {
      if (packPathsRelativeToTsconfig.has(file)) {
        return;
      }
      for (const excl of packPathsRelativeToTsconfig) {
        if (file.startsWith(excl)) {
          return;
        }
      }
    } else {
      if (packPathsRelativeToTsconfig.has(file)) {
        const relativePack = path.relative(srcManifestDir, file);
        return extractPack(path.join(outDir, relativePack), path.join(srcManifestDir, relativePack), {clean: true});
      }
      for (const packAbsolute of packPathsRelativeToTsconfig) {
        if (file.startsWith(packAbsolute)) {
          const relativePack = path.relative(srcManifestDir, packAbsolute);
          return extractPack(path.join(outDir, relativePack), path.join(srcManifestDir, relativePack), {clean: true});
        }
      }
    }
    return processFile(file, outDir!, rootDir).catch(console.error);
  };
  const tsWatcher = await TsCompiler.createTsWatch({rootDir, outDir});
  stoppables.push({stop: () => tsWatcher.close()})
  const nonTsWatcher = TsConfig.watchNonTsFiles(tsConfig);
  stoppables.push({stop: () => nonTsWatcher.removeAllListeners()})
  nonTsWatcher.addListener('add', fileCb);
  nonTsWatcher.addListener('change', fileCb);
  nonTsWatcher.addListener('unlink', fileCb);
  if (srcManifest) {
    // Process manifest (again) now that all other files are present
    nonTsWatcher.once('ready', () => processFile(srcManifest.filePath, outDir!, rootDir));
  }

  // Start the foundry server
  let foundrySpawn: ChildProcess;
  if (foundryRunConfig) {
    foundrySpawn = FoundryVTT.startServer(foundryRunConfig.runInstanceKey);
    stoppables.push({stop: () => foundrySpawn.kill()});
    foundrySpawn.addListener('exit', async (code, signal) => {
      const promises: Promise<void>[] = [];
      for (const pack of packManifestPaths) {
        promises.push(extractPack(path.join(outDir, pack), path.join(srcManifestDir, pack), {clean: true}));
      }
      await Promise.all(promises);
      process.kill(process.pid, signal);
    });
    process.once('SIGINT', (signal: NodeJS.Signals) => {
      for (const stoppable of stoppables) {
        stoppable.stop();
      }
    });
  }

  return {
    stop: () => {
      for (const stoppable of stoppables) {
        stoppable.stop();
      }
    }
  }
}

export async function compileReadme(): Promise<void> {
  const html = await FoundryVTT.markdownToHtml(fs.readFileSync('./README.md', 'utf8'));
  fs.writeFileSync('./README.html', html, 'utf8');
}

export async function manifestForGithubCurrentVersion(): Promise<void> {
  const srcPath = preBuildValidation().rootDir;
  const manifest = FoundryVTT.readManifest(srcPath);
  await Git.setGithubLinks(manifest.manifest, false);
  await FoundryVTT.writeManifest(manifest, manifestWriteOptions);
}

export async function manifestForGithubLatestVersion(): Promise<void> {
  const srcPath = preBuildValidation().rootDir;
  const manifest = FoundryVTT.readManifest(srcPath);
  await Git.setGithubLinks(manifest.manifest, true);
  await FoundryVTT.writeManifest(manifest, manifestWriteOptions);
}

export async function rePublish(): Promise<void> {
  const currentVersion = await Git.getLatestVersionTag();
  await Git.deleteVersionTag(currentVersion);
  await Git.tagCurrentVersion(currentVersion);
}

export async function publish(newVersion: Version): Promise<void> {
  const gitVersion = await Git.getLatestVersionTag();
  const versions = [newVersion, await Git.getLatestVersionTag()].sort(Version.sort);
  if (versions[1] !== newVersion) {
    throw new Error(`New version is not higher. old: ${Version.toString(gitVersion)} | new: ${Version.toString(newVersion)}`);
  }
  await Git.validateCleanRepo();

  const srcPath = preBuildValidation().rootDir;
  const manifest = FoundryVTT.readManifest(srcPath, {nullable: true});
  if (manifest) {
    manifest.manifest.version = Version.toString(newVersion);
    await Git.setGithubLinks(manifest.manifest, false);
    await FoundryVTT.writeManifest(manifest, manifestWriteOptions);
  }

  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  packageJson.version = Version.toString(newVersion);
  fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2), 'utf8');

  await Git.commitNewVersion(newVersion);
  await Git.push();
  // If for some reason the tag already exists
  await Git.deleteVersionTag(newVersion);
  await Git.tagCurrentVersion(newVersion);
}
