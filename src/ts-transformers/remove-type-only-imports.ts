import ts from 'typescript';
import { createFullTraverseTransformer } from './transformer.js';

const virtualSymbolFlags = ts.SymbolFlags.Interface |  ts.SymbolFlags.Signature |
  ts.SymbolFlags.TypeAlias | ts.SymbolFlags.TypeLiteral | ts.SymbolFlags.TypeParameter;

export const removeTypeOnlyImportsTransformer = createFullTraverseTransformer(({program, node, next}) => {
  if (!ts.isImportDeclaration(node)) {
    return next();
  }
  
  if (!node.importClause?.namedBindings || !ts.isNamedImports(node.importClause.namedBindings)) {
    return next();
  }
  
  const typeChecker = program.getTypeChecker();
  const nonTypeElements: ts.ImportSpecifier[] = [];
  for (const namedImport of node.importClause.namedBindings.elements) {
    const namedImportSymbol = typeChecker.getAliasedSymbol(typeChecker.getSymbolAtLocation(namedImport.name));
    console.log(namedImport.getText(), namedImportSymbol.flags)
    if (!(namedImportSymbol.flags & virtualSymbolFlags)) {
      nonTypeElements.push(namedImport);
    }
  }

  if (nonTypeElements.length === node.importClause.namedBindings.elements.length) {
    return next();
  }
  if (nonTypeElements.length === 0) {
    return undefined;
  }

  return ts.factory.updateImportDeclaration(
    node,
    node.modifiers,
    ts.factory.updateImportClause(
      node.importClause,
      node.importClause.isTypeOnly,
      node.importClause.name,
      ts.factory.updateNamedImports(
        node.importClause.namedBindings,
        nonTypeElements,
      )
    ),
    node.moduleSpecifier,
    node.assertClause,
  );
})
