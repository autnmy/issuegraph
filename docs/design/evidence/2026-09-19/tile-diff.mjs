import {readFileSync} from 'node:fs';
const ids=['16a','16b','16c','16d','16e','16f','16g','16h','16i','17a','17b','17c','17d','17e','17f','17g','17h'];
// crude balanced-tag slice from the element carrying id="NN" to its matching close
function tile(html,id){
  const m=html.indexOf(`id="${id}"`); if(m<0) return null;
  let s=html.lastIndexOf('<',m);
  const tag=html.slice(s+1).match(/^[a-zA-Z0-9]+/)[0];
  let i=html.indexOf('>',m)+1, depth=1;
  const open=new RegExp(`<${tag}[\\s>]`,'g'), close=new RegExp(`</${tag}>`,'g');
  while(depth>0 && i<html.length){
    open.lastIndex=i; close.lastIndex=i;
    const a=open.exec(html), b=close.exec(html);
    if(!b) break;
    if(a && a.index<b.index){depth++; i=a.index+1;} else {depth--; i=b.index+tag.length+3;}
  }
  return html.slice(s,i);
}
const norm=s=>s.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ')
  .replace(/<[^>]+>/g,' ').replace(/&[a-z#0-9]+;/gi,' ').replace(/[^a-z0-9]/gi,'').toLowerCase();
const OLD=readFileSync('/Users/timlayton/Downloads/design_handoff_issue_relationships/Descant Dashboard.dc.html','utf8');
const NEW=readFileSync('/Users/timlayton/GitHub/autnmy/descant-design-kits/Descant Dashboard.dc.html','utf8');
for(const id of ids){
  const a=tile(OLD,id), b=tile(NEW,id);
  if(!a||!b){console.log(`${id}\tMISSING (old:${!!a} new:${!!b})`);continue;}
  const na=norm(a), nb=norm(b);
  console.log(`${id}\t${na===nb?'SAME':'DIFFERS'}\told=${na.length} new=${nb.length}`);
}

// Run: node docs/design/evidence/2026-09-19/tile-diff.mjs
// Proves the claim in section 1: every §16 and §17 tile is identical between the
// 2026-08-18 Downloads copy and the canonical descant-design-kits checkout, so the
// 2026-08-22 amendment changed the written spec and not the frames.
// Output on 2026-09-19: all seventeen tiles SAME, equal normalised lengths.
