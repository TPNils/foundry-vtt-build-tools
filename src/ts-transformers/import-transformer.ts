import path from 'path';
import ts from 'typescript';

function mutateModuleSpecifierText(program: ts.Program, node: ts.Node): string | null {
  if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) {
    return null;
  }
  if (node.moduleSpecifier === undefined || !ts.isStringLiteral(node.moduleSpecifier)) {
    return null;
  }
  if (!node.moduleSpecifier.text.startsWith('./') && !node.moduleSpecifier.text.startsWith('../')) {
    return null;
  }
  if (path.extname(node.moduleSpecifier.text) !== '') {
    return null;
  }
  return `${node.moduleSpecifier.text}.js`;
}

export function createImportTransformer(program: ts.Program): ts.TransformerFactory<ts.SourceFile> {
  return (context) => {
    return (node) => {
      console.log(node.fileName)
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