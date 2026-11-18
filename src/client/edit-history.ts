import type { NodeLayout } from '../shared/map-types.ts'
import { canonicalJson } from '../shared/fingerprint.ts'
import type { Edit } from '../server/edit-service.ts'
export type HistoryValue=Edit|{kind:'move';viewId:string;node:NodeLayout}
export interface HistoryEntry { entryId:string; kind:'details'|'layout'|'move'; localRevision:number; nodeId?:string; assetIds?:string[]; before:HistoryValue; after:HistoryValue; viewId:string }
export class EditHistory {
  entries:HistoryEntry[]=[]
  cursor=0
  record(entry:HistoryEntry) {
    if(canonicalJson(entry.before)===canonicalJson(entry.after))return
    this.entries.splice(this.cursor)
    const texts=[entry.before,entry.after].flatMap(e=>e.kind==='details'?[e.markdown]:[])
    entry.nodeId=entry.after.kind==='details'?entry.after.nodeId:entry.after.kind==='move'?entry.after.node.nodeId:undefined
    entry.assetIds=[...new Set(texts.flatMap(text=>[...text.matchAll(/([A-Za-z0-9_-]+)\.image\.json/g)].map(m=>m[1])))]
    this.entries.push(structuredClone(entry))
    if(this.entries.length>30)this.entries.shift()
    this.cursor=this.entries.length
  }
  undo(){return this.cursor>0?this.entries[--this.cursor]:undefined}
  redo(){return this.cursor<this.entries.length?this.entries[this.cursor++]:undefined}
  clear(){this.entries=[];this.cursor=0}
}
