import path from 'path';
import ts from 'typescript';
import { createFullTraverseTransformer } from './transformer.js';

const virtualSymbolFlags = ts.SymbolFlags.Interface |  ts.SymbolFlags.Signature |
  ts.SymbolFlags.TypeAlias | ts.SymbolFlags.TypeLiteral | ts.SymbolFlags.TypeParameter;

function mutateNamedImports(program: ts.Program, node: ts.ImportDeclaration): ts.ImportSpecifier[] | null {
  const typeChecker = program.getTypeChecker();
  if (node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
    const nonTypeElements: ts.ImportSpecifier[] = [];
    for (const namedImport of node.importClause.namedBindings.elements) {
      const namedImportSymbol = typeChecker.getAliasedSymbol(typeChecker.getSymbolAtLocation(namedImport.name));
      if (!(namedImportSymbol.flags & virtualSymbolFlags)) {
        nonTypeElements.push(namedImport);
      }
    }
    if (nonTypeElements.length < node.importClause.namedBindings.elements.length) {
      return nonTypeElements
    }
  }

  return null;
}

function mutateModuleSpecifierText(program: ts.Program, node: ts.Node): string | null {
  if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) {
    return null;
  }
  if (node.moduleSpecifier === undefined || !ts.isStringLiteral(node.moduleSpecifier)) {
    return null;
  }
  if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) {
    return null;
  }

  const importSymbol = program.getTypeChecker().getSymbolAtLocation(node.moduleSpecifier);
  const sourceFile = importSymbol?.declarations?.find(d => ts.isSourceFile(d)) as ts.SourceFile | null;
  if (!sourceFile || sourceFile.isDeclarationFile) {
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
  if (program.isSourceFileFromExternalLibrary(sourceFile)) {
    return null; // TODO inject
  }
  
  const relativePath = path.posix.relative(path.dirname(node.getSourceFile().fileName), sourceFile.fileName);

  return `./${relativePath.replace(/\.ts$/, '.js')}`;
}

export const appendJsExtensionTransformer = createFullTraverseTransformer(({program, node, next}) => {
  const mutate = mutateModuleSpecifierText(program, node);
  if (mutate == null) {
    return next();
  }

  if (ts.isImportDeclaration(node)) {
    const namedImports = mutateNamedImports(program, node);
    if (namedImports?.length === 0) {
      return undefined;
    }
    return ts.factory.updateImportDeclaration(
      node,
      node.modifiers,
      namedImports == null ? node.importClause : ts.factory.updateImportClause(
        node.importClause,
        node.importClause.isTypeOnly,
        node.importClause.name,
        ts.factory.updateNamedImports(
          node.importClause.namedBindings as ts.NamedImports,
          namedImports
        )
      ),
      ts.factory.createStringLiteral(mutate),
      node.assertClause,
    );
  } else if (ts.isExportDeclaration(node)) {
    return ts.factory.updateExportDeclaration(
      node,
      node.modifiers,
      node.isTypeOnly,
      node.exportClause,
      ts.factory.createStringLiteral(mutate),
      node.assertClause,
    );
  }
})
