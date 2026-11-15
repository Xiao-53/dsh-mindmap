import { memo, useMemo, useRef, useState } from 'react'
import { useAnimatedPorts } from '../animate-ports.ts'
import type { CSSProperties, MutableRefObject } from 'react'
import type { KnowledgeMap, KnowledgeNode, NodeLayout, Relation, View, ViewLayout } from '../../shared/map-types.ts'
import { nodeHeight, viewBounds } from '../../shared/layout.ts'
import type { Heights } from '../../shared/layout.ts'
import { createConnections, PORT_RADIUS, INPUT_PORT_STROKE, OUTPUT_PORT_STROKE } from '../../shared/edge-geometry.ts'
import { NodeCard, palette } from './NodeCard.tsx'
interface SceneHandlers {
  open: (id:string)=>void; note:(id:string)=>void; menu:(id:string,x:number,y:number)=>void
  move?: (id:string,x:number,y:number)=>void; start:()=>void; commit:()=>void; end:()=>void
}
const SceneNode = memo(function SceneNode({node,layout,viewId,selected,locked,handlers}: {
  node:KnowledgeNode;layout:NodeLayout;viewId:string;selected:boolean;locked:boolean;handlers:MutableRefObject<SceneHandlers>
}) {
  return <NodeCard node={node} layout={layout} viewId={viewId} selected={selected} locked={locked}
    onOpen={()=>handlers.current.open(node.id)} onNote={()=>handlers.current.note(node.id)} onMenu={(x,y)=>handlers.current.menu(node.id,x,y)}
    onMove={handlers.current.move ? (x,y)=>handlers.current.move?.(node.id,x,y) : undefined}
    onDragStart={()=>handlers.current.start()} onCommit={()=>handlers.current.commit()} onDragEnd={()=>handlers.current.end()} />
})
const SceneEdge = memo(function SceneEdge({relation:r,d,arrow,stem,ax,ay,bx,by}: {
  relation:Relation;d:string;arrow:string;stem:string;ax:number;ay:number;bx:number;by:number
}) {
  const secondary=r.type==='supplement',color=secondary?'#c0a385':'#91a796'
  return <g data-relation={r.id} style={{opacity:secondary ? 0.58 : 0.76}}>
    <path className={`edge ${secondary?'secondary':''}`} d={d} stroke={color} style={{opacity:1,strokeLinecap:'butt'}} />
    <path d={stem} style={{fill:'none',stroke:color,strokeWidth:secondary?1.8:2,strokeDasharray:'none',strokeLinecap:'butt'}} />
    <path className="edge-arrow" d={arrow} style={{fill:color,stroke:'none'}} />
    {r.label && <text className="edge-label" x={(ax+bx)/2} y={(ay+by)/2-8} textAnchor="middle">{r.label}</text>}
  </g>
})
export function MapScene({ map, view, layout, heights, selected, onOpen, onNote, onMenu, onMove, onCommit, onDragStart, onDragEnd, locked = false }: {
  map: KnowledgeMap; view: View; layout: ViewLayout; heights: Heights; selected?: string
  onOpen: (id: string) => void; onNote: (id: string) => void
  onMenu: (id: string, x: number, y: number) => void
  onMove?: (id: string, x: number, y: number) => void
  onCommit?: () => void; onDragStart?: () => void; onDragEnd?: () => void; locked?: boolean
}) {
  const [dragging,setDragging]=useState(false)
  const [preview,setPreview]=useState<ViewLayout>()
  const previewRef=useRef<ViewLayout>()
  const target=dragging && preview ? preview : layout
  const visualLayout=target
  const bounds=viewBounds(visualLayout,heights)
  const nodes=useMemo(()=>new Map(map.nodes.map(node=>[node.id,node])),[map.nodes])
  const groups=useMemo(()=>new Map(view.groups.map(group=>[group.id,group])),[view.groups])
  const edges=useMemo(()=>{const relations=new Map(map.relations.map(relation=>[relation.id,relation]));return view.relationIds.map(id=>relations.get(id)!)},[map.relations,view.relationIds])
  const rects=useMemo(()=>Object.fromEntries(visualLayout.nodes.map(node=>[node.nodeId,{...node,height:nodeHeight(heights,view.id,node.nodeId)}])),[visualLayout,heights,view.id])
  // 节点直接跟手，仅端点重排沿卡片边缘过渡；线条和箭头共享端点动画帧。
  const connections=useMemo(()=>createConnections(rects,edges),[rects,edges])
  const {ports,segments}=useAnimatedPorts(connections,rects,view.id)
  const handlers=useRef<SceneHandlers>({open:onOpen,note:onNote,menu:onMenu,start:()=>{},commit:()=>{},end:()=>{}})
  handlers.current={open:onOpen,note:onNote,menu:onMenu,
    move:onMove ? (id,x,y)=>{
      const base=previewRef.current ?? layout
      const old=base.nodes.find(node=>node.nodeId===id)
      if(!old || old.x===x && old.y===y) return
      const next={...base,nodes:base.nodes.map(node=>node.nodeId===id ? {...node,x,y,manual:true} : node)}
      previewRef.current=next;setPreview(next);onMove(id,x,y)
    } : undefined,
    start:()=>{previewRef.current=layout;setDragging(true);onDragStart?.()},
    commit:()=>onCommit?.(),
    end:()=>{setDragging(false);setPreview(undefined);previewRef.current=undefined;onDragEnd?.()},
  }
  return <div className="scene-content" style={{width:Math.max(1140,bounds.x+bounds.width+40),height:Math.max(800,bounds.y+bounds.height+40)}}>
    {visualLayout.groups.map(group=>{
      const data=groups.get(group.groupId)!
      return <div key={group.groupId} className="group-area" style={{left:group.x,top:group.y,width:group.width,height:group.height,'--group-color':palette[data.category].color} as CSSProperties}>
        <div className="group-title"><span>{data.number}</span>{data.title}</div>
      </div>
    })}
    <svg className="edges" aria-hidden="true">{segments.map(segment=><SceneEdge key={segment.relation.id} relation={segment.relation} d={segment.d} arrow={segment.arrow} stem={segment.stem} ax={segment.source.x} ay={segment.source.y} bx={segment.target.x} by={segment.target.y}/>)}</svg>
    {visualLayout.nodes.map(node=><SceneNode key={node.nodeId} node={nodes.get(node.nodeId)!} layout={node} viewId={view.id} selected={selected===node.nodeId} locked={locked} handlers={handlers}/>)}
    <svg className="atlas-ports" aria-hidden="true" style={{position:'absolute',left:0,top:0,width:'100%',height:'100%',overflow:'visible',pointerEvents:'none',zIndex:9}}>
      {ports.map(port=><circle key={`${port.edgeIndex}-${port.role}`} data-edge={port.edgeIndex} data-side={port.side} data-node-port={port.nodeId} cx={port.x} cy={port.y} r={PORT_RADIUS} fill={port.role==='in'?'#8699aa':'#fffdf8'} stroke={port.role==='in'?'#8699aa':'#b38c97'} strokeWidth={port.role==='in'?INPUT_PORT_STROKE:OUTPUT_PORT_STROKE}/>)}
    </svg>
  </div>
}
