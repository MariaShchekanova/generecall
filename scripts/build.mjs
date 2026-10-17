import {readFile,writeFile,mkdir,copyFile,rm} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const read=p=>readFile(new URL(p,root),'utf8');
const [engine,server,html,snapshot,report]=await Promise.all(['src/engine.mjs','src/server.mjs','src/index.html','src/demo-clinvar.json','src/demo-report.txt'].map(read));
const core=engine.replace(/^export /gm,'');
const routes=server.replace(/^import[^\n]*\n/gm,'').replace(/^export /gm,'');
const source=`// GeneRecall. Generated from src by scripts/build.mjs. No credentials.\n${core}\nconst APP_HTML=${JSON.stringify(html)};\nconst DEMO_SNAPSHOT=${snapshot};\nconst DEMO_REPORT=${JSON.stringify(report)};\n${routes}\nexport default { fetch: handleRequest };\n`;
await mkdir(new URL('dist/server/',root),{recursive:true});
await writeFile(new URL('dist/server/index.js',root),source);
try {
  // Local development and a teammate's copy do not need a hosting account.
  await readFile(new URL('.openai/hosting.json',root));
  await mkdir(new URL('dist/.openai/',root),{recursive:true});
  await copyFile(new URL('.openai/hosting.json',root),new URL('dist/.openai/hosting.json',root));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  await rm(new URL('dist/.openai/hosting.json',root),{force:true});
}
const worker=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
if(typeof worker.default?.fetch!=='function')throw Error('Worker is invalid');
console.log('Built and validated GeneRecall Worker.');
