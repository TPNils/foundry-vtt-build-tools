import ts from 'typescript';

export type FullVisitor = (params: {program: ts.Program, node: ts.Node, next: () => ts.VisitResult<ts.Node>}) => ts.VisitResult<ts.Node>;

export function createFullTraverseTransformer(visitor: FullVisitor): (program: ts.Program) => ts.TransformerFactory<ts.SourceFile> {
  return function appendJsExtensionTransformer(program: ts.Program): ts.TransformerFactory<ts.SourceFile> {
    return (context) => {
      const recursiveVisitor: ts.Visitor = (node: ts.Node) => {
        return visitor({
          program,
          node,
          next: () => ts.visitEachChild(node, recursiveVisitor, context),
        });
      }

      return (node) => ts.visitNode(node, recursiveVisitor);
    }
  }
}