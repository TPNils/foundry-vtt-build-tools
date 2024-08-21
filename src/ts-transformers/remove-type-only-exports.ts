import ts from 'typescript';
import { createFullTraverseTransformer } from './transformer.js';

const virtualSymbolFlags = ts.SymbolFlags.Interface |  ts.SymbolFlags.Signature |
  ts.SymbolFlags.TypeAlias | ts.SymbolFlags.TypeLiteral | ts.SymbolFlags.TypeParameter;

export const removeTypeOnlyExportTransformer = createFullTraverseTransformer(({program, node, next}) => {
  if (!ts.isExportDeclaration(node)) {
    return next();
  }

  if (node.isTypeOnly) {
    return undefined;
  }
  
  if (node.exportClause == null || !ts.isNamedExports(node.exportClause)) {
    return next();
  }
  
  const typeChecker = program.getTypeChecker();
  const nonTypeElements: ts.ExportSpecifier[] = [];
  for (const namedExport of node.exportClause.elements) {
    const namedImportSymbol = typeChecker.getAliasedSymbol(typeChecker.getSymbolAtLocation(namedExport.name));
    if (!(namedImportSymbol.flags & virtualSymbolFlags) || namedImportSymbol.flags & ts.SymbolFlags.Namespace) {
      nonTypeElements.push(namedExport);
    }
  }

  if (nonTypeElements.length === node.exportClause.elements.length) {
    return next();
  }
  if (nonTypeElements.length === 0) {
    return undefined;
  }

  return ts.factory.updateExportDeclaration(
    node,
    node.modifiers,
    node.isTypeOnly,
    ts.factory.updateNamedExports(
      node.exportClause,
      nonTypeElements,
    ),
    node.moduleSpecifier,
    node.assertClause,
  );
})
