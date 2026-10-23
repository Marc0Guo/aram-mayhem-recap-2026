import { toBlob } from 'html-to-image'
import background from './assets/mayhem-background.jpg'

export async function downloadRecapPng(options: { title: string; includeAlias: boolean }): Promise<string> {
  const source = document.querySelector<HTMLElement>('.recap')
  const shell = document.querySelector<HTMLElement>('.shell')
  if (!source || !shell) throw new Error('export-not-ready')
  await document.fonts.ready
  const stage = document.createElement('div')
  Object.assign(stage.style,{position:'fixed',left:'-30000px',top:'0'})
  const surface = document.createElement('div')
  surface.className = 'shell png-export-surface'
  surface.dataset.material = shell.dataset.material ?? 'glass'
  const width = Math.ceil(source.getBoundingClientRect().width) + 40
  Object.assign(surface.style, {position:'relative',width:`${width}px`,maxWidth:'none',padding:'20px',margin:'0',overflow:'hidden',background:'#101d32',isolation:'isolate'})
  const backdrop = new Image()
  backdrop.src = background
  backdrop.alt = ''
  Object.assign(backdrop.style,{position:'absolute',inset:'-24px',width:'calc(100% + 48px)',height:'calc(100% + 48px)',objectFit:'cover',filter:'blur(15px) brightness(.7) saturate(.85)',zIndex:'-1'})
  surface.append(backdrop)
  const recap = source.cloneNode(true) as HTMLElement
  if (options.title) { const heading=recap.querySelector('h1'); if(heading) heading.textContent=options.title }
  if (!options.includeAlias) { const alias=recap.querySelector('[data-testid="account-alias"]'); if(alias)alias.textContent=''; const heading=recap.querySelector('h1'); if(heading&&!options.title)heading.textContent=document.documentElement.lang==='zh-CN'?'海克斯大乱斗年终总结':'ARAM MAYHEM Recap 2026' }
  surface.append(recap)
  stage.append(surface)
  document.body.append(stage)
  try {
    await Promise.all([...surface.querySelectorAll('img')].map(async img=>{if(img.src) await img.decode().catch(()=>{throw new Error('export-image-unavailable')})}))
    const blob = await toBlob(surface,{pixelRatio:2,backgroundColor:'#101d32',skipFonts:true,style:{position:'relative',left:'0',top:'0',margin:'0'},cacheBust:false})
    if (!blob || blob.size < 1000) throw new Error('export-empty')
    const filename = `${(options.title || 'ARAM-Mayhem-Recap-2026').replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').slice(0,100)}.png`
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a'); link.href=url; link.download=filename; document.body.append(link); link.click(); link.remove()
    window.setTimeout(()=>URL.revokeObjectURL(url),60_000)
    return filename
  } finally { stage.remove() }
}
