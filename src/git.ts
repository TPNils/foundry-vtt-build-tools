import chalk from 'chalk';
import { context as githubContext } from '@actions/github';
import { Cli } from './cli.js';
import { Version } from './version.js';
import { FoundryVTT } from './foundy-vtt.js';

export class Git {

  public static async setGithubLinks(manifest: FoundryVTT.Manifest.LatestVersion, isLatest: boolean): Promise<void> {
    const githubRepository = await Git.getGithubRepoName();
    if (githubRepository == null) {
      throw new Error(chalk.red(`Git no github repository found.`));
    }
    const versionString = Version.toString(Version.parse(manifest.version))

    manifest.url = `https://github.com/${githubRepository}`;
    // When foundry checks if there is an update, it will fetch the manifest present in the zip, for us it points to the latest one.
    // The external one should point to itself so you can download a specific version
    // The zipped one should point to the latest manifest so when the "check for update" is executed it will fetch the latest
    if (isLatest) {
      // The manifest which is within the module zip
      manifest.manifest = `https://github.com/${githubRepository}/releases/download/latest/module.json`;
    } else {
      // Seperate file uploaded for github
      manifest.manifest = `https://github.com/${githubRepository}/releases/download/${versionString}/module.json`;
    }
    manifest.download = `https://github.com/${githubRepository}/releases/download/${versionString}/module.zip`;
  }

  public static async getGithubRepoName(): Promise<string | null> {
    let githubRepository: string | null = null;

    // Try to detect the github repo in a github action
    if (githubContext.payload?.repository?.full_name) {
      githubRepository = githubContext.payload?.repository?.full_name;
    }

    if (githubRepository == null) {
      let remoteName: string | null = null;
      {
        const out = await Cli.execPromise('git remote');
        if (out.stdout) {
          const lines = out.stdout.split('\n');
          if (lines.length === 1) {
            remoteName = lines[0];
          }
        }
      }
      if (remoteName == null) {
        // Find the correct remote
        const out = await Cli.execPromise('git branch -vv --no-color');
        if (out.stdout) {
          const rgx = /^\* [^\s]+ +[0-9a-fA-F]+ \[([^\/]+)\//;
          for (const line of out.stdout.split('\n')) {
            const match = rgx.exec(line);
            if (match) {
              remoteName = match[1];
            }
          }
        }
      }

      if (remoteName != null) {
        const remoteUrl = await Cli.execPromise(`git`, [`remote`, `get-url`, `--push`, remoteName.replace(/"/g, '\\"')]);
        Cli.throwIfError(remoteUrl);
        const sshRgx = /^git@github\.com:(.*)\.git$/i.exec(remoteUrl?.stdout?.trim() ?? '');
        if (sshRgx) {
          githubRepository = sshRgx[1];
        } else {
          const httpRgx = /^https?:\/\/github\.com\/(.*)\.git$/i.exec(remoteUrl?.stdout?.trim() ?? '');
          if (httpRgx) {
            githubRepository = httpRgx[1];
          }
        }
      }
    }
    
    return githubRepository;
  }

  public static async validateCleanRepo(): Promise<void> {
    const cmd = await Cli.execPromise('git', ['status', '--porcelain']);
    Cli.throwIfError(cmd);
    if (typeof cmd.stdout === 'string' && cmd.stdout.length > 0) {
      throw new Error("You must first commit your pending changes");
    }
  }

  public static async commitNewVersion(version: Version): Promise<void> {
    Cli.throwIfError(await Cli.execPromise('git', ['add', '.']), {ignoreOut: true});
    Cli.throwIfError(await Cli.execPromise(`git`, [`commit`, `-m`, `"Updated to ${Version.toString(version)}"`]));
  }

  public static async deleteVersionTag(version: Version): Promise<void> {
    // Ignore errors
    await Cli.execPromise(`git tag -d ${Version.toString(version)}`);
    await Cli.execPromise(`git push --delete origin ${Version.toString(version)}`);
  }

  public static async getCurrentLongHash(): Promise<string | null> {
    const hash = await Cli.execPromise(`git rev-parse HEAD`);
    Cli.throwIfError(hash);
    return hash.stdout?.split('\n')?.[0] ?? null;
  }

  public static async tagCurrentVersion(version: Version): Promise<void> {
    let versionStr = Version.toString(version);
    Cli.throwIfError(await Cli.execPromise(`git`, [`tag`, `-a`, versionStr, `-m`, `"Updated to ${versionStr}"`]));
    Cli.throwIfError(await Cli.execPromise(`git`, [`push`, `origin`, versionStr]), {ignoreOut: true});
  }

  public static async getFileAtCommit(commitHash: string, filePath: string): Promise<string> {
    const file = await Cli.execPromise(`git`, [`--no-pager`, `show`, `${commitHash}:${filePath}`]);
    Cli.throwIfError(file);
    return file.stdout;
  }

  public static async getLatestVersionTag(): Promise<Version> {
    const versions = await Git.getAllVersionTags();
    if (!versions.length) {
      return {major: 0, minor: 0, patch: 0};
    }
    return versions[versions.length - 1].version;
  }

  /** Return all tagged versions, sorted from earliest version to latest based on the version number */
  public static async getAllVersionTags(): Promise<Array<{hash: string; version: Version}>> {
    const tagHash = await Cli.execPromise('git show-ref --tags');
    const rgx = /([0-9a-fA-F]+) refs\/tags\/(.*)/g;
    let match: RegExpExecArray | null;
    const response: Array<{hash: string; version: Version}> = [];
    while (match = rgx.exec(tagHash.stdout ?? '')) {
      try {
        response.push({hash: match[1], version: Version.parse(match[2])});
      } catch {/*ignore*/}
    }
    return response.sort((a, b) => Version.sort(a.version, b.version));
  }

  public static async push(): Promise<void> {
    Cli.throwIfError(await Cli.execPromise(`git push`), {ignoreOut: true});
  }

}