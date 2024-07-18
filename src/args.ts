import { Version } from "./version";
import * as chalk from 'chalk';
import * as yargs from 'yargs';

export class Args {
  private static args: {
    u?: string; update?: string;
    fi?: string; foundryinstance?: string;
  } = yargs.argv;
 
  public static getNextVersion(currentVersion: Version): Version {
    const version = this.args.update || this.args.u;
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
        }
      } else if (version.toLowerCase() === 'minor') {
        targetVersion = {
          ...currentVersion,
          minor: currentVersion.minor+1,
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
  
  public static getFoundryInstanceName(): string | undefined {
    return this.args.foundryinstance ?? this.args.fi;
  }
}