import {build} from './vendor-build/node_modules/esbuild/lib/main.js';
import {mkdir,readFile,writeFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
const here=path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
const root=decodeURIComponent(here),modules=path.join(root,'vendor-build/node_modules'),out=path.join(root,'public/vendor');
await mkdir(out,{recursive:true});
for(const [entry,file]of [['export {marked} from "marked"; export {default as purify} from "dompurify";','markup.mjs'],['export {default} from "mermaid";','mermaid.mjs']])await build({stdin:{contents:entry,resolveDir:modules},bundle:true,minify:true,format:'esm',platform:'browser',target:'es2024',outfile:path.join(out,file),legalComments:'eof',logLevel:'warning'});
let licenses='Vendored browser renderers; built from the pinned npm lockfile.\n\n';
async function scan(folder){for(const name of await readdir(folder)){const p=path.join(folder,name),s=await stat(p);if(s.isDirectory()){await scan(p);}else if(/^licen[sc]e(\.|$)/i.test(name))licenses+='\n--- '+path.relative(modules,p)+' ---\n'+await readFile(p,'utf8')+'\n';}}
await scan(modules);await writeFile(path.join(out,'LICENSES.txt'),licenses);console.log('Bundled local Markdown and Mermaid renderers.');
