import ts from 'typescript';
import { createFullTraverseTransformer } from './transformer.js';

const virtualSymbolFlags = ts.SymbolFlags.Interface |  ts.SymbolFlags.Signature |
  ts.SymbolFlags.TypeAlias | ts.SymbolFlags.TypeLiteral | ts.SymbolFlags.TypeParameter;

export const removeTypeOnlyImportsTransformer = createFullTraverseTransformer(({program, node, next}) => {
  if (!ts.isNamedImports(node)) {
    return next();
  }
  
  const typeChecker = program.getTypeChecker();
  const nonTypeElements: ts.ImportSpecifier[] = [];
  for (const namedImport of node.elements) {
    const namedImportSymbol = typeChecker.getAliasedSymbol(typeChecker.getSymbolAtLocation(namedImport.name));
    console.log(namedImport.getText(), namedImportSymbol.flags)
    if (!(namedImportSymbol.flags & virtualSymbolFlags)) {
      nonTypeElements.push(namedImport);
    }
  }

  if (nonTypeElements.length === node.elements.length) {
    return next();
  }
  if (nonTypeElements.length === 0) {
    return undefined;
  }

  return ts.factory.updateNamedImports(
    node,
    nonTypeElements,
  );
})
