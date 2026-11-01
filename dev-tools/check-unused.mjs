import ts from 'typescript';
import path from 'node:path';

const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
const files = parsed.fileNames;
const host = {
  getScriptFileNames: () => files,
  getScriptVersion: () => '0',
  getScriptSnapshot: (file) =>
    ts.sys.fileExists(file) ? ts.ScriptSnapshot.fromString(ts.sys.readFile(file)) : undefined,
  getCurrentDirectory: () => process.cwd(),
  getCompilationSettings: () => parsed.options,
  getDefaultLibFileName: ts.getDefaultLibFilePath,
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
  readDirectory: ts.sys.readDirectory,
};
const service = ts.createLanguageService(host);
const program = service.getProgram();
const localPath = (file) => path.relative(process.cwd(), file).replaceAll('\\', '/');
const sources = files.filter(
  (file) => localPath(file).startsWith('src/') && !file.endsWith('.d.ts'),
);
const unused = [];
for (const file of sources) {
  const source = program.getSourceFile(file);
  function visit(node) {
    const exported =
      ts.canHaveModifiers(node) &&
      ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    const method = ts.isMethodDeclaration(node) && node.body;
    function checkName(name) {
      if (!name || !ts.isIdentifier(name)) return;
      const references =
        service
          .findReferences(file, name.getStart(source))
          ?.flatMap((reference) => reference.references)
          .filter((reference) => !reference.isDefinition) ?? [];
      if (!references.length) unused.push(localPath(file) + ':' + name.text);
    }
    if (exported && ts.isVariableStatement(node))
      node.declarationList.declarations.forEach((declaration) => checkName(declaration.name));
    else if (exported || method) checkName(node.name);
    ts.forEachChild(node, visit);
  }
  visit(source);
}
// 从应用和核心测试入口检查模块可达性；引擎扩展属于包约定入口，在其集成测试中验证。
const reachable = new Set();
function follow(file) {
  file = path.resolve(file);
  if (reachable.has(file)) return;
  reachable.add(file);
  const source = program.getSourceFile(file);
  if (!source) return;
  // Vite 的独立 Worker 是 new Worker(new URL('./entry.ts', import.meta.url))，不是静态 import。
  function followWorker(node) {
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'Worker'
    ) {
      const url = node.arguments?.[0];
      if (
        url &&
        ts.isNewExpression(url) &&
        ts.isIdentifier(url.expression) &&
        url.expression.text === 'URL'
      ) {
        const entry = url.arguments?.[0];
        if (entry && ts.isStringLiteral(entry) && entry.text.startsWith('.'))
          follow(path.resolve(path.dirname(file), entry.text));
      }
    }
    ts.forEachChild(node, followWorker);
  }
  followWorker(source);
  const imports = ts.preProcessFile(source.text).importedFiles;
  for (const dependency of imports) {
    const resolved = ts.resolveModuleName(
      dependency.fileName,
      file,
      parsed.options,
      ts.sys,
    ).resolvedModule;
    if (resolved && !resolved.isExternalLibraryImport) follow(resolved.resolvedFileName);
  }
}
follow('src/main.tsx');
files.filter((file) => /\.test\.tsx?$/.test(file)).forEach(follow);
const orphans = sources.filter((file) => !reachable.has(path.resolve(file))).map(localPath);
service.dispose();
if (unused.length || orphans.length) {
  console.error(JSON.stringify({ unused, orphans }, null, 2));
  process.exitCode = 1;
} else console.log('源码引用检查通过：未使用导出/方法 0，不可达源码模块 0。');
