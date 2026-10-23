import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
const root = process.cwd()
const publish = path.join(root, 'publish')
const stamp = new Date().toISOString().replace(/[:.]/g,'-')
const stage = path.join(publish, stamp, 'aram-mayhem-recap-2026')
fs.mkdirSync(stage,{recursive:true})
const folders = ['src','scripts','tests','fixtures','e2e','docs','.cursor','.github']
const files = ['.gitignore','.gitattributes','.npmrc','AGENTS.md','CLAUDE.md','README.md','README.zh-CN.md','PRD.md','LICENSE','THIRD_PARTY_NOTICES.md','CONTRIBUTING.md','SECURITY.md','CHANGELOG.md','package.json','pnpm-lock.yaml','electron-builder.yml','electron.vite.config.ts','eslint.config.mjs','playwright.config.ts','vitest.config.ts','tsconfig.json','tsconfig.node.json','tsconfig.web.json']
const allowed = (name) => !/(?:\.sqlite(?:[.-].*)?|\.db(?:[.-].*)?|\.log|\.partial|\.private\.[^.]+)$/i.test(name) && !name.startsWith('.env') && !/^history-(?:recovery|and-material)/.test(name)
const copy=(from,to)=>{const stat=fs.lstatSync(from);if(stat.isSymbolicLink())throw Error('Source contains a symlink: '+path.relative(root,from));if(stat.isDirectory()){fs.mkdirSync(to,{recursive:true});for(const item of fs.readdirSync(from))if(allowed(item))copy(path.join(from,item),path.join(to,item))}else fs.copyFileSync(from,to)}
for(const name of [...files,...folders]) if(fs.existsSync(path.join(root,name)))copy(path.join(root,name),path.join(stage,name))
const archive = path.join(publish,`aram-mayhem-recap-2026-${stamp}.zip`)
const result=spawnSync('powershell.exe',['-NoProfile','-Command','Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory($env:ARAM_RELEASE_STAGE, $env:ARAM_RELEASE_ZIP, [IO.Compression.CompressionLevel]::Optimal, $true)'],{env:{...process.env,ARAM_RELEASE_STAGE:stage,ARAM_RELEASE_ZIP:archive},encoding:'utf8',windowsHide:true})
if(result.status!==0)throw Error(result.stderr||'Source archive failed')
console.log(JSON.stringify({stage,archive}))
