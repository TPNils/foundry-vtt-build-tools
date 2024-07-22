import path from 'path';
import ts from 'typescript';
import { FoundryVTT } from '../foundy-vtt.js';
import { createFullTraverseTransformer } from './transformer.js';

function mutateModuleSpecifierText(program: ts.Program, node: ts.ImportDeclaration): string | null {
  if (!ts.isStringLiteral(node.moduleSpecifier)) {
    return null;
  }

  const importSymbol = program.getTypeChecker().getSymbolAtLocation(node.moduleSpecifier);
  const sourceFile = importSymbol?.declarations?.find(d => ts.isSourceFile(d)) as ts.SourceFile | null;
  if (!sourceFile) {
    return null;
  }

  // if a given symbol belongs to a standard library (Date)
  // (undocumented in typescript itself)
  // https://www.satellytes.com/blog/post/typescript-ast-type-checker/
  if (program.isSourceFileDefaultLibrary(sourceFile)) {
    return null;
  }

  // if a given symbol belongs tod an external library (whatever you use from node_modules)
  // (undocumented in typescript itself)
  // https://www.satellytes.com/blog/post/typescript-ast-type-checker/
  if (!program.isSourceFileFromExternalLibrary(sourceFile)) {
    return null;
  }
  
  let manifest: FoundryVTT.Manifest;
  let traversingDir = path.normalize(sourceFile.fileName);
  while (!fs.existsSync(path.join(traversingDir, 'package.json'))) {
    manifest = FoundryVTT.readManifest(traversingDir, {nullable: true});
    if (manifest) {
      break;
    }
    traversingDir = path.dirname(traversingDir);
  }

  if (!manifest) {
    return null;
  }
  
  const manifestDir = path.resolve(path.dirname(manifest.filePath));

  return `/` + path.posix.join(
    `${manifest.type}s`,
    manifest.manifest.id,
    path.relative(manifestDir, sourceFile.fileName.replace(/(?:\.d)?\.ts$/, '.js')).split(path.sep).join(path.posix.sep)
  );
}

export const foundryVttModuleImportTransformer = createFullTraverseTransformer(({program, node, next}) => {
  if (ts.isImportDeclaration(node)) {
    const mutate = mutateModuleSpecifierText(program, node);
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
})
