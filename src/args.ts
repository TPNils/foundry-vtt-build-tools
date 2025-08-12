import { Version } from './version.js';
import chalk from 'chalk';

function toShortArg(arg: string): string {
  return arg.replace(/(?:^|-)([^\-])([^\-]*)/g, `$1`).toLowerCase();
}

export class Args {

  static #getArg(short: string, long: string, type: 'boolean'): boolean
  static #getArg(short: string, long: string, type?: 'string'): string | null
  static #getArg(short: string, long: string, type: 'string' | 'boolean' = 'string'): boolean | string | null {
    short = short.replace(/^-{0,1}/, '-');
    long = long.replace(/^-{0,2}/, '--');
    for (let i = 0; i < process.argv.length; i++) {
      const arg = process.argv[i];
      if (arg === short || arg === long) {
        return type === 'boolean' ? true : process.argv[i+1]
      } else if (arg.startsWith(short + '=')) {
        const value = arg.substring(short.length+1);
        if (type === 'boolean') {
          return Boolean(value);
        }
        return value;
      } else if (arg.startsWith(long + '=')) {
        const value = arg.substring(long.length+1);
        if (type === 'boolean') {
          return Boolean(value);
        }
        return value;
      }
    }

    return null;
  }
 
  public static getNextVersion(currentVersion: Version): Version {
    const version = Args.#getArg('u', 'update');
    if (!version) {
      throw new Error('Missing version number. Use -u <version> (or --update) to specify a version.');
    }
  
    let targetVersion: Version | null = null;
  
    if (Version.isVersionString(version)) {
      targetVersion = Version.parse(version);
    } else {
      if (version.toLowerCase() === 'major') {
        targetVersion = {
          ...currentVersion,
          major: currentVersion.major+1,
          minor: 0,
          patch: 0,
        }
      } else if (version.toLowerCase() === 'minor') {
        targetVersion = {
          ...currentVersion,
          minor: currentVersion.minor+1,
          patch: 0,
        }
      } else if (version.toLowerCase() === 'patch') {
        targetVersion = {
          ...currentVersion,
          patch: currentVersion.patch+1,
        }
      }
    }
  
    if (targetVersion == null) {
      throw new Error(chalk.red('Error: Incorrect version arguments. Accepts the following:\n- major\n- minor\n- patch\n- the following patterns: 1.0.0 | 1.0.0-beta'));
    }
    return targetVersion;
  }
  
  public static readonly foundryReleaseTokenArgLong = 'foundry-release-token';
  public static readonly foundryReleaseTokenArgShort = toShortArg(Args.foundryReleaseTokenArgLong);
  public static getFoundryReleaseToken(): string | undefined {
    return Args.#getArg(Args.foundryReleaseTokenArgShort, Args.foundryReleaseTokenArgLong);
  }
  
  public static readonly versionArgLong = 'version';
  public static readonly versionArgShort = toShortArg(Args.versionArgLong);
  public static getVersion(): Version | undefined {
    const version = Args.#getArg(Args.versionArgShort, Args.versionArgLong);
    if (Version.isVersionString(version)) {
      return Version.parse(version);
    }
    if (version) {
      throw new Error(`Invalid version (${version}) for -${Args.versionArgShort}/--${Args.versionArgLong}. Expected format: v1.0.0 or 1.0.0 or 1.0 or 1`);
    }
  }
  
  public static readonly foundryInstanceNameArgLong = 'foundry-instance';
  public static readonly foundryInstanceNameArgShort = toShortArg(Args.foundryInstanceNameArgLong);
  public static getFoundryInstanceName(): string | undefined {
    return Args.#getArg(Args.foundryInstanceNameArgShort, Args.foundryInstanceNameArgLong);
  }
  
  public static readonly useAllFoundryInstancesArgLong = 'all-foundry-instances';
  public static readonly useAllFoundryInstancesArgShort = toShortArg(Args.useAllFoundryInstancesArgLong);
  public static getUseAllFoundryInstances(): boolean {
    return Args.#getArg(Args.useAllFoundryInstancesArgLong, Args.useAllFoundryInstancesArgShort, 'boolean');
  }
}