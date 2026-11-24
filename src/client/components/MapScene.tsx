import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAnimatedPorts } from '../animate-ports.ts'
import type { CSSProperties, MutableRefObject } from 'react'
import type { KnowledgeMap, KnowledgeNode, NodeLayout, View, ViewLayout, Relation } from '../../shared/map-types.ts'
import { nodeHeight, viewBounds } from '../../shared/layout.ts'
import type { Heights } from '../../shared/layout.ts'
import { createConnections, PORT_RADIUS, INPUT_PORT_STROKE, OUTPUT_PORT_STROKE } from '../../shared/edge-geometry.ts'
import type { EdgeRouteHint } from '../../shared/edge-geometry.ts'
import { NodeCard, palette } from './NodeCard.tsx'
interface SceneHandlers {
  open: (id:string)=>void; select?:(id:string)=>void; note:(id:string)=>void; menu?:(id:string,x:number,y:number)=>void
  move?: (id:string,x:number,y:number)=>void; start:()=>void; commit:()=>void; end:()=>void
}
const SceneNode = memo(function SceneNode({node,layout,viewId,selected,locked,handlers}: {
  node:KnowledgeNode;layout:NodeLayout;viewId:string;selected:boolean;locked:boolean;handlers:MutableRefObject<SceneHandlers>
}) {
  return <NodeCard node={node} layout={layout} viewId={viewId} selected={selected} locked={locked}
    onOpen={()=>handlers.current.open(node.id)}
    onSelect={handlers.current.select ? ()=>handlers.current.select?.(node.id) : undefined}
    onNote={()=>handlers.current.note(node.id)}
    onMenu={handlers.current.menu ? (x,y)=>handlers.current.menu?.(node.id,x,y) : undefined}
    onMove={handlers.current.move ? (x,y)=>handlers.current.move?.(node.id,x,y) : undefined}
    onDragStart={()=>handlers.current.start()} onCommit={()=>handlers.current.commit()} onDragEnd={()=>handlers.current.end()} />
})
export function classifyEdgeFocus(relation: Pick<Relation, 'fromNodeId' | 'toNodeId'> & { type: string }, selectedNodeId?: string): 'default' | 'in' | 'out' | 'supplement' | 'dimmed' {
  if (!selectedNodeId) return 'default'
  if (relation.fromNodeId !== selectedNodeId && relation.toNodeId !== selectedNodeId) return 'dimmed'
  if (relation.type === 'supplement') return 'supplement'
  return relation.toNodeId === selectedNodeId ? 'in' : 'out'
}
type EdgeRelation = ReturnType<typeof createConnections>['segments'][number]['relation']
type FocusRole = ReturnType<typeof classifyEdgeFocus>
const SceneEdge = memo(function SceneEdge({relation:r,d,arrow,stem,focusRole}: {
  focusRole: FocusRole; relation: EdgeRelation;d:string;arrow:string;stem:string
}) {
  const secondary=r.type==='supplement',color=secondary?'var(--edge-secondary, #c0a385)':'var(--edge-primary, #91a796)'
  const focused = focusRole !== 'default' && focusRole !== 'dimmed'
  return <g data-relation={r.id} data-focus={focusRole === 'default' ? undefined : focusRole}
    className={focusRole === 'default' ? undefined : focusRole === 'dimmed' ? 'edge-dimmed' : `edge-focus-${focusRole}`}
    style={{opacity:focusRole === 'dimmed' ? .2 : focused ? secondary ? .88 : .96 : secondary ? .58 : .76}}>
    {focused && <path className="edge-focus-halo" d={d} />}
    <path className={`edge ${secondary?'secondary':''}`} d={d} stroke={color} style={{opacity:1,strokeLinecap:'butt',strokeWidth:(secondary ? 1.8 : 2) + (focused ? .4 : 0)}} />
    <path d={stem} style={{fill:'none',stroke:color,strokeWidth:secondary?1.8:2,strokeDasharray:'none',strokeLinecap:'butt'}} />
    <path className="edge-arrow" d={arrow} style={{fill:color,stroke:'none'}} />
  </g>
})
// 关系名称为卡片之上、端口之下的 HTML 胶囊；位置由路由沿线避卡计算，悬停仅显示完整标题。
const ScenePill = memo(function ScenePill({relation:r,x,y,maxWidth,focusRole}: {
  focusRole: FocusRole; relation: EdgeRelation;x:number;y:number;maxWidth?:number
}) {
  const focused = focusRole !== 'default' && focusRole !== 'dimmed'
  const className = ['edge-pill', r.type==='supplement' && 'secondary', focused && 'is-focused', focusRole === 'dimmed' && 'is-dimmed', focused && `edge-focus-${focusRole}`].filter(Boolean).join(' ')
  return <span className={className} data-relation={r.id} data-focus={focusRole === 'default' ? undefined : focusRole} title={r.label} style={maxWidth !== undefined ? {left:x,top:y,maxWidth} : {left:x,top:y}}>{r.label}</span>
})
export function MapScene({ map, view, layout, heights, selected, onOpen, onSelect, onNote, onMenu, onMove, onCommit, onDragStart, onDragEnd, locked = false }: {
  map: KnowledgeMap; view: View; layout: ViewLayout; heights: Heights; selected?: string
  onOpen: (id: string) => void; onSelect?: (id: string) => void; onNote: (id: string) => void
  onMenu?: (id: string, x: number, y: number) => void
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
  // 节点直接跟手，仅端点重排沿卡片边缘过渡；线条和箭头共享端点动画帧与按视图隔离的瞬态滞回提示。
  const routeHintsRef=useRef<{ viewId: string; map: Map<string, EdgeRouteHint> }>({ viewId: view.id, map: new Map() })
  const connections=useMemo(()=>{
    const prevHints=routeHintsRef.current.viewId===view.id ? routeHintsRef.current.map : undefined
    return createConnections(rects,edges,undefined,{hints:prevHints,dragging,groups:visualLayout.groups})
  },[rects,edges,view.id,dragging,visualLayout.groups])
  useLayoutEffect(()=>{
    routeHintsRef.current={viewId:view.id,map:connections.hints}
  },[view.id,connections])
  const {ports,segments}=useAnimatedPorts(connections,rects,view.id,{dragging,hints:connections.hints,groups:visualLayout.groups})
  const handlers=useRef<SceneHandlers>({open:onOpen,select:onSelect,note:onNote,menu:onMenu,start:()=>{},commit:()=>{},end:()=>{}})
  handlers.current={open:onOpen,select:onSelect,note:onNote,menu:onMenu,
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
  // 常态连线位于卡片下层；仅单击选中节点时其直接关联连线提到卡片之上，悬停不改变层级。
  const roles=segments.map(segment=>({segment,focusRole:classifyEdgeFocus(segment.relation,selected)}))
  const baseEdges=roles.filter(item=>item.focusRole==='default' || item.focusRole==='dimmed')
  const focusEdges=selected ? roles.filter(item=>item.focusRole!=='default' && item.focusRole!=='dimmed') : []
  const renderEdge=({segment,focusRole}:(typeof roles)[number])=><SceneEdge key={segment.relation.id} relation={segment.relation} focusRole={focusRole} d={segment.d} arrow={segment.arrow} stem={segment.stem}/>
  return <div className="scene-content" style={{width:Math.max(1140,bounds.x+bounds.width+40),height:Math.max(800,bounds.y+bounds.height+40)}}>
    {visualLayout.groups.map(group=>{
      const data=groups.get(group.groupId)!
      return <div key={group.groupId} className="group-area" style={{left:group.x,top:group.y,width:group.width,height:group.height,'--group-color':palette[data.category].color} as CSSProperties}>
        <div className="group-title"><span>{data.number}</span>{data.title}</div>
      </div>
    })}
    <svg className="edges edges-base" aria-hidden="true">{baseEdges.map(renderEdge)}</svg>
    {visualLayout.nodes.map(node=><SceneNode key={node.nodeId} node={nodes.get(node.nodeId)!} layout={node} viewId={view.id} selected={selected===node.nodeId} locked={locked} handlers={handlers}/>)}
    {focusEdges.length>0 && <svg className="edges edges-focus" aria-hidden="true">{focusEdges.map(renderEdge)}</svg>}
    <div className="edge-labels" aria-hidden="true">{roles.filter(({segment})=>segment.relation.label?.trim()).map(({segment,focusRole})=><ScenePill key={segment.relation.id} relation={segment.relation} focusRole={focusRole} x={segment.label.x} y={segment.label.y} maxWidth={segment.label.maxWidth}/>)}</div>
    <svg className="atlas-ports" aria-hidden="true" style={{position:'absolute',left:0,top:0,width:'100%',height:'100%',overflow:'visible',pointerEvents:'none',zIndex:9}}>
      {ports.map(port=><circle key={`${port.edgeIndex}-${port.role}`} data-edge={port.edgeIndex} data-side={port.side} data-node-port={port.nodeId} cx={port.x} cy={port.y} r={PORT_RADIUS} fill={port.role==='in'?'var(--port-in, #8699aa)':'var(--port-out-fill, #fffdf8)'} stroke={port.role==='in'?'var(--port-in, #8699aa)':'var(--port-out, #b38c97)'} strokeWidth={port.role==='in'?INPUT_PORT_STROKE:OUTPUT_PORT_STROKE}/>)}
    </svg>
  </div>
}
