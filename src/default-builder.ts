#!/usr/bin/env node
import path from "path";
import { build, buildZip, compileReadme, preBuildValidation, watch, publishGit, rePublish, manifestForGithubCurrentVersion, manifestForGithubLatestVersion, publishFoundryVtt } from './tasks.js';
import { Args } from './args.js';
import { FoundryVTT } from './foundy-vtt.js';
import { Git } from './git.js';

function getFoundryOutDir(): string | null {
  const srcDir = preBuildValidation().rootDir;
  const manifest = FoundryVTT.readManifest(srcDir, {nullable: true});
  if (!manifest) {
    return null;
  }
  const fi = Args.getFoundryInstanceName();
  if (fi) {
    return path.join(FoundryVTT.getRunConfig(fi).dataPath, 'Data', `${manifest.type}s`, manifest.manifest.id);
  } else if (Args.getUseAllFoundryInstances()) {
    for (const fConfig of FoundryVTT.getRunConfigs()) {
      return path.join(fConfig.dataPath, 'Data', `${manifest.type}s`, manifest.manifest.id);
    }
  }
  return null;
}

async function start() {
  switch (process.argv[2]) {
    case 'build': {
      build(getFoundryOutDir());
      break;
    }
    case 'buildZip': {
      buildZip();
      break;
    }
    case 'compileReadme': {
      compileReadme();
      break;
    }
    case 'watch': {
      watch(getFoundryOutDir());
      break;
    }
    case 'publish': {
      publishGit(Args.getNextVersion(await Git.getLatestVersionTag()));
      break;
    }
    case 'publishFoundryVtt': {
      const foundryReleaseToken = Args.getFoundryReleaseToken();
      if (!foundryReleaseToken) {
        console.error(`Missing argument "--${Args.foundryReleaseTokenArgLong}"`);
        process.exit(1);
      }
      publishFoundryVtt(foundryReleaseToken, Args.getVersion());
      break;
    }
    case 'reupload': {
      rePublish();
      break;
    }
    case 'updateZipManifestForGithub': {
      manifestForGithubCurrentVersion();
      break;
    }
    case 'updateExternalManifestForGithub': {
      manifestForGithubLatestVersion();
      break;
    }
  
    default: {
      throw new Error(`Unknown command: ${process.execArgv.join(' ')}`)
    }
  }
}

start();