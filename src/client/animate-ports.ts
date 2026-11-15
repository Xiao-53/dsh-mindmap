import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { connectionGeometry } from '../shared/edge-geometry.ts'
import type { createConnections, Port, Rect } from '../shared/edge-geometry.ts'

const DURATION = 180
type Connections = ReturnType<typeof createConnections>
interface Motion { from:number; to:number; start:number }
const wrap = (value:number) => ((value % 4) + 4) % 4
const position = (motion:Motion,time:number) => {
  const t=Math.min(1,Math.max(0,(time-motion.start)/DURATION))
  return motion.from+(motion.to-motion.from)*(1-(1-t)**3)
}
// 用节点边缘的局部位置补间；节点整体移动不参与动画，仍然直接跟手。
// 这是端点重排的位置反馈，不随减少装饰动画设置跳过。
const offset = (port:Port,node:Rect) => port.side==='top' ? (port.x-node.x)/node.width
  : port.side==='right' ? 1+(port.y-node.y)/node.height
  : port.side==='bottom' ? 3-(port.x-node.x)/node.width
  : 4-(port.y-node.y)/node.height
function place(port:Port,node:Rect,value:number):Port {
  const p=wrap(value)
  if(p<1) return {...port,side:'top',x:node.x+p*node.width,y:node.y}
  if(p<2) return {...port,side:'right',x:node.x+node.width,y:node.y+(p-1)*node.height}
  if(p<3) return {...port,side:'bottom',x:node.x+(3-p)*node.width,y:node.y+node.height}
  return {...port,side:'left',x:node.x,y:node.y+(4-p)*node.height}
}

export function useAnimatedPorts(target:Connections,nodes:Record<string,Rect>,viewId:string):Connections {
  const [,setTime]=useState(0)
  const motions=useRef(new Map<string,Motion>())
  const activeView=useRef(viewId)
  const request=useRef(0)
  const edgeIds=useMemo(()=>new Map(target.segments.map(segment=>[segment.source.edgeIndex,segment.relation.id])),[target])
  const key=(port:Port)=>`${edgeIds.get(port.edgeIndex)}:${port.role}:${port.nodeId}`
  useLayoutEffect(()=>()=>{cancelAnimationFrame(request.current);request.current=0},[])
  useLayoutEffect(()=>{
    const now=performance.now()
    if(activeView.current!==viewId) {
      motions.current.clear();activeView.current=viewId
    }
    const keys=new Set<string>()
    for(const port of target.ports) {
      const id=key(port),goal=offset(port,nodes[port.nodeId])
      keys.add(id)
      const previous=motions.current.get(id)
      if(!previous) motions.current.set(id,{from:goal,to:goal,start:now})
      else {
        // 同一目标槽位不因每次pointermove重启动画；新目标从当前可见位置接续。
        const delta=wrap(goal-previous.to+2)-2
        if(Math.abs(delta)>1e-6) {
          const from=position(previous,now)
          motions.current.set(id,{from,to:from+wrap(goal-from+2)-2,start:now})
        }
      }
    }
    for(const id of motions.current.keys()) if(!keys.has(id)) motions.current.delete(id)
    const tick=(time:number)=>{
      request.current=0
      setTime(time)
      if([...motions.current.values()].some(motion=>motion.from!==motion.to && time-motion.start<DURATION)) request.current=requestAnimationFrame(tick)
    }
    if(!request.current && [...motions.current.values()].some(motion=>motion.from!==motion.to && now-motion.start<DURATION)) request.current=requestAnimationFrame(tick)
  },[target,nodes,viewId])
  const now=performance.now()
  const ports=target.ports.map(port=>{
    const motion=activeView.current===viewId ? motions.current.get(key(port)) : undefined
    return motion ? place(port,nodes[port.nodeId],position(motion,now)) : port
  })
  const byRole=new Map(ports.map(port=>[`${port.edgeIndex}:${port.role}`,port]))
  return {ports,segments:target.segments.map(segment=>{
    const source=byRole.get(`${segment.source.edgeIndex}:out`)!
    const target=byRole.get(`${segment.target.edgeIndex}:in`)!
    return {...segment,source,target,...connectionGeometry(source,target,segment.self)}
  })}
}
