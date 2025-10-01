// FILE: frontend/mall-skin.js
(function(){
  const PALETTE = [
    "#90CAF9","#A5D6A7","#FFCDD2","#FFE082","#B39DDB",
    "#80CBC4","#F48FB1","#FFAB91","#AED581","#81D4FA",
  ];
  const pickColor = (key) => {
    let h=0; for(let i=0;i<key.length;i++) h=(h*131+key.charCodeAt(i))>>>0;
    return PALETTE[h%PALETTE.length];
  };
  const asArray = (sel,root) => Array.from((root||document).querySelectorAll(sel));

  function ensureDefs(svg){
    let defs = svg.querySelector("defs"); if(!defs){ defs=document.createElementNS(svg.namespaceURI,"defs"); svg.prepend(defs); }

    // Multi-shadow = ดูนูน
    if(!svg.querySelector("#mall-shadow")){
      const f = document.createElementNS(svg.namespaceURI,"filter");
      f.id="mall-shadow"; f.setAttribute("x","-30%"); f.setAttribute("y","-30%"); f.setAttribute("width","160%"); f.setAttribute("height","160%");
      f.innerHTML = `
        <feDropShadow dx="0" dy="1.2" stdDeviation="1.2" flood-color="#000" flood-opacity="0.20"/>
        <feDropShadow dx="0" dy="6" stdDeviation="6" flood-color="#000" flood-opacity="0.10"/>
        <feDropShadow dx="0" dy="12" stdDeviation="12" flood-color="#000" flood-opacity="0.08"/>
      `;
      defs.appendChild(f);
    }
    // Inner glow = ดูยกขอบด้านใน
    if(!svg.querySelector("#inner-glow")){
      const g = document.createElementNS(svg.namespaceURI,"filter");
      g.id="inner-glow";
      g.innerHTML = `
        <feFlood flood-color="#ffffff" result="f" flood-opacity=".95"/>
        <feComposite in="f" in2="SourceAlpha" operator="in" result="glow"/>
        <feGaussianBlur in="glow" stdDeviation="2" result="blur"/>
        <feComposite in="SourceGraphic" in2="blur" operator="atop"/>
      `;
      defs.appendChild(g);
    }
    // Floor gradient
    if(!svg.querySelector("#corridorGrad")){
      const lg = document.createElementNS(svg.namespaceURI,"linearGradient");
      lg.id="corridorGrad"; lg.setAttribute("x1","0"); lg.setAttribute("x2","1"); lg.setAttribute("y1","0"); lg.setAttribute("y2","1");
      lg.innerHTML = `
        <stop offset="0%" stop-color="#f0f7ff"/>
        <stop offset="100%" stop-color="#dbeafe"/>
      `;
      defs.appendChild(lg);
    }
    // Hatch สำหรับ unknown
    if(!svg.querySelector("#hatch")){
      const pat = document.createElementNS(svg.namespaceURI,"pattern");
      pat.id="hatch"; pat.setAttribute("patternUnits","userSpaceOnUse"); pat.setAttribute("width","6"); pat.setAttribute("height","6");
      pat.innerHTML=`<path d="M0,6 6,0" stroke="#e5e7eb" stroke-width="1"/>`;
      defs.appendChild(pat);
    }
  }

  function classify(el){
    const id=(el.id||"").toLowerCase();
    const cl=(el.getAttribute("class")||"").toLowerCase();
    const token = id+" "+cl;
    if(/(wall|outline|border)/.test(token)) return "wall";
    if(/(corridor|hall|lobby|aisle|passage)/.test(token)) return "corridor";
    if(/(toilet|restroom|washroom|wc)/.test(token)) return "toilet";
    if(/(service|staff|back|utility|machine)/.test(token)) return "service";
    if(/(shop|store|room|unit|lot|tenant)/.test(token)) return "shop";
    return "unknown";
  }

  function styleElement(el, kind){
    // normalize
    el.setAttribute("vector-effect","non-scaling-stroke");
    el.setAttribute("stroke-linejoin","round");
    el.setAttribute("stroke-linecap","round");

    if(kind==="wall"){
      el.setAttribute("fill","none");
      el.setAttribute("stroke","var(--mall-wall)");
      el.setAttribute("stroke-width","2");
      return;
    }

    if(kind==="corridor"){
      el.setAttribute("fill","url(#corridorGrad)");
      el.setAttribute("stroke","#ffffff");
      el.setAttribute("stroke-width","2.2");
      el.setAttribute("filter","url(#inner-glow)");
      return;
    }

    if(kind==="toilet"){
      el.setAttribute("fill","#E0F7FA");
      el.setAttribute("stroke","#ffffff"); el.setAttribute("stroke-width","1.6");
      el.setAttribute("filter","url(#mall-shadow)");
      return;
    }

    if(kind==="service"){
      el.setAttribute("fill","#ECEFF1");
      el.setAttribute("stroke","#ffffff"); el.setAttribute("stroke-width","1.4");
      el.setAttribute("filter","url(#mall-shadow)");
      return;
    }

    // shop / unknown
    const key = (el.id || el.getAttribute("data-name") || "x")+kind;
    const fill = (kind==="shop") ? pickColor(key) : "url(#hatch)";
    el.setAttribute("fill", fill);
    el.setAttribute("stroke","#ffffff");
    el.setAttribute("stroke-width","1.8");
    el.setAttribute("filter","url(#mall-shadow)");
  }

  function makeBuildingPlate(svg){
    // หา outline ใหญ่สุด แล้วทำเงาใต้ตึก
    const polys = asArray("path,polygon,rect", svg);
    if(!polys.length) return;
    let big = polys[0], areaMax=-1;
    for(const p of polys){
      const bb=p.getBBox?.(); if(!bb) continue;
      const area=bb.width*bb.height; if(area>areaMax){ areaMax=area; big=p; }
    }
    if(!big) return;
    const plate = big.cloneNode(true);
    plate.removeAttribute("id");
    plate.setAttribute("fill","var(--mall-floor)");
    plate.setAttribute("stroke","none");
    plate.setAttribute("filter","url(#mall-shadow)");
    // ใส่ไว้หลังสุด
    svg.insertBefore(plate, svg.firstChild);
  }

  function beautify(svg){
    ensureDefs(svg);
    // แปะคลาส host เพื่อให้ CSS ภายนอกทำงาน
    (svg.parentElement||svg).classList.add("svg-host");

    // 1) building plate
    makeBuildingPlate(svg);

    // 2) style all shapes
    const shapes = asArray("path,polygon,rect", svg);
    for(const el of shapes){
      const k = classify(el);
      if(el.tagName==="rect"){
        // why: มุมมนให้ฟีลนุ่ม
        const r = Math.min(6, Math.round(Math.min(el.width?.baseVal?.value||6, el.height?.baseVal?.value||6)/6));
        if(r>0){ el.setAttribute("rx", r); el.setAttribute("ry", r); }
      }
      styleElement(el, k);
    }
  }

  // Public API
  window.applyMallSkin = function(svg, enable=true){
    if(!svg) return;
    if(enable){ beautify(svg); svg.setAttribute("data-mall-skin","on"); }
    else { // remove only our effects
      const defs = svg.querySelector("defs");
      ["#mall-shadow","#inner-glow","#corridorGrad","#hatch"].forEach(id=>{
        const el = defs?.querySelector(id); if(el) el.remove();
      });
      asArray("[filter*='mall-shadow'],[filter*='inner-glow']", svg).forEach(e=>e.removeAttribute("filter"));
      asArray("[fill='url(#corridorGrad)']", svg).forEach(e=>e.removeAttribute("fill"));
      svg.removeAttribute("data-mall-skin");
    }
  };

  // small helper for toggling with persistence
  const KEY="MALL_SKIN_ON";
  window.isMallSkinOn = ()=> localStorage.getItem(KEY)!=="0";
  window.setMallSkin = (on)=>{
    localStorage.setItem(KEY, on? "1":"0");
    const svg = document.querySelector("#svg-container svg"); 
    if(svg) applyMallSkin(svg, on);
    document.body.classList.toggle("mall-skin-on", on);
  };
})();
