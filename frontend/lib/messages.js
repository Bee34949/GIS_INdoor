export function renderRouteOnSvg(svg, segments, meta){
  if(!svg) return;
  // clear old
  svg.querySelectorAll(".path-line,.path-node").forEach(el=>el.remove());
  for(const seg of segments){
    if(seg.nodes.length<2) continue;
    const pts = seg.nodes.map(k=>({x:meta.byKey[k].x, y:meta.byKey[k].y}));
    const pl = document.createElementNS("http://www.w3.org/2000/svg","polyline");
    pl.setAttribute("points", pts.map(p=>`${p.x},${p.y}`).join(" "));
    pl.setAttribute("fill","none"); pl.setAttribute("stroke","red"); pl.setAttribute("stroke-width","3");
    pl.classList.add("path-line"); svg.appendChild(pl);
  }
}
export function showSteps(list, containerId="route-steps"){
  const el = document.getElementById(containerId);
  if(!el){ alert(list.join("\n")); return; }
  el.innerHTML = list.map(s=>`<li class="p-2 border-b">${s}</li>`).join("");
}