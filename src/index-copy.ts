import * as fs from 'fs';
import * as path from 'path';
import * as open from 'open';
import { getTsconfig } from 'get-tsconfig';

import { exec } from 'child_process';
import { buildMeta } from './build-meta';
import { args } from './args';
import { Git } from './git';
import { FoundryVTT } from './foundy-vtt';
import { Version } from './version';
import { TsCompiler } from './ts-compiler';
import { TsConfig } from './ts-config';

function startFoundry() {
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

function findMostCommonDir(files: Iterable<string>): string {
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

  return mostCommonDir;
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
  console.log(findMostCommonDir(TsConfig.getNonTsFiles()))
}
start();