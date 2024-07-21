import path from 'path';
import ts from 'typescript';

function mutateModuleSpecifierText(program: ts.Program, node: ts.Node): string | null {
  if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) {
    return null;
  }
  if (node.moduleSpecifier === undefined || !ts.isStringLiteral(node.moduleSpecifier)) {
    return null;
  }

  const importSymbol = program.getTypeChecker().getSymbolAtLocation(node.moduleSpecifier);
  const sourceFile = importSymbol.declarations?.find(d => ts.isSourceFile(d)) as ts.SourceFile | null;
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

export function appendJsExtensionTransformer(program: ts.Program): ts.TransformerFactory<ts.SourceFile> {
  return (context) => {
    return (node) => {
      function visitor(node: ts.Node) {
        const mutate = mutateModuleSpecifierText(program, node);
        if (mutate != null) {
          if (ts.isImportDeclaration(node)) {
            return ts.factory.updateImportDeclaration(
              node,
              node.modifiers,
              node.importClause,
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
        }
        return ts.visitEachChild(node, visitor, context);
      }
  
      return ts.visitNode(node, visitor);
    };
  }
}