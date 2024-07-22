import path from 'path';
import fs from 'fs';
import ts from 'typescript';
import { FoundryVTT } from '../foundy-vtt.js';
import { Npm } from '../npm.js';
import { findMostCommonDir } from '../tasks.js';
import { createFullTraverseTransformer } from './transformer.js';

function mutateModuleSpecifierText(program: ts.Program, node: ts.ImportDeclaration, inclModules: Npm.PackageQuery[]): string | null {
  if (!ts.isStringLiteral(node.moduleSpecifier)) {
    return null;
  }

  const originNode = ts.getParseTreeNode(node) as ts.ImportDeclaration ?? node;

  const importSymbol = program.getTypeChecker().getSymbolAtLocation((ts.isImportDeclaration(originNode) ? originNode : node).moduleSpecifier);
  const importFromSourceFile = importSymbol?.declarations?.find(d => ts.isSourceFile(d)) as ts.SourceFile | null;
  if (!importFromSourceFile) {
  //   try {
  //     console.log('no source', node.getText())
  //   } catch {
  //     let sourceNode: ts.Node = node;
  //     while (sourceNode && !ts.isSourceFile(sourceNode)) {
  //       sourceNode = sourceNode.parent;
  //       console.log('')
  //     }
  //     console.log('no source', originNode.getText())
  //   }
    // Could be an import of d.ts files or isSourceFileDefaultLibrary
    return null;
  }

  // if a given symbol belongs to a standard library (Date)
  // (undocumented in typescript itself)
  // https://www.satellytes.com/blog/post/typescript-ast-type-checker/
  if (program.isSourceFileDefaultLibrary(importFromSourceFile)) {
    return null;
  }

  // if a given symbol belongs tod an external library (whatever you use from node_modules)
  // (undocumented in typescript itself)
  // https://www.satellytes.com/blog/post/typescript-ast-type-checker/
  if (!program.isSourceFileFromExternalLibrary(importFromSourceFile)) {
    return null;
  }

  // Change imports for bundled packages
  for (const bundle of inclModules) {
    const bundleDir = bundle.path.split(path.posix.sep).join(path.sep);
    const importFromPath = importFromSourceFile.fileName.split(path.posix.sep).join(path.sep);
    if (importFromPath.startsWith(bundleDir)) {
      const srcDir = program.getCompilerOptions()?.rootDir ?? findMostCommonDir(program.getRootFileNames());
      const sourceFile = node.getSourceFile().fileName.split(path.posix.sep).join(path.sep);
      const importFileRelative = path.relative(
        bundle.path.split(path.posix.sep).join(path.sep),
        importFromSourceFile.fileName.split(path.posix.sep).join(path.sep)
      );
      const relative = path.relative(
        path.dirname(sourceFile),
        path.join(srcDir, bundle.location, importFileRelative),
      ).replace(/(?:\.d)?\.ts$/, '.js').split(path.sep).join(path.posix.sep);
      console.log('relative', relative)
      return relative;
    }
  }
  
  // Change imports to foundry vtt urls
  let manifest: FoundryVTT.Manifest;
  let traversingDir = path.normalize(importFromSourceFile.fileName);
  while (!fs.existsSync(path.join(traversingDir, 'package.json'))) {
    manifest = FoundryVTT.readManifest(traversingDir, {nullable: true});
    if (manifest) {
      break;
    }
    traversingDir = path.dirname(traversingDir);
  }

  if (manifest) {
    console.log('manifest', manifest.filePath)
    const manifestDir = path.resolve(path.dirname(manifest.filePath));
  
    return `/` + path.posix.join(
      `${manifest.type}s`,
      manifest.manifest.id,
      path.relative(manifestDir, importFromSourceFile.fileName.replace(/(?:\.d)?\.ts$/, '.js')).split(path.sep).join(path.posix.sep)
    );
  }

  console.log('no manifest or bundle', importFromSourceFile.fileName)
  return null;
}

export const foundryVttModuleImportTransformer = (program: ts.Program, inclModules: Npm.PackageQuery[] = []) => {
  
  return createFullTraverseTransformer(({program, node, next}) => {
    if (ts.isImportDeclaration(node)) {
      const mutate = mutateModuleSpecifierText(program, node, inclModules);
      if (mutate == null) {
        return next();
      }
      return ts.factory.updateImportDeclaration(
        node,
        node.modifiers,
        node.importClause,
        ts.factory.createStringLiteral(mutate),
        node.assertClause,
      );
    }
  
    return next();
  })(program);
}
