/*
  Simulador de engranajes simple y funcional.
  - Añadir engranajes (botón izquierdo)
  - Click simple abre inspector (diámetro, dientes, establecer motriz, rpm si motriz)
  - Doble click para mover: arrastra mientras pulsado
  - Colocar sobre otro = mismo centro => giran a la MISMA velocidad
  - Si engranajes en contacto (distancia <= r1 + r2 + tolerancia) => ruedas engranan:
      omega2 = - omega1 * (d1 / d2)  (se usa la relación de diámetros; signo invertido por reverso)
  - Solamente el motriz puede editar rpm.
  - Lista en la esquina inferior derecha muestra info resumida
  - Comenzar/Detener controla la animación
*/

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let DPR = devicePixelRatio || 1;
function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.max(1, Math.floor(w * DPR));
  canvas.height = Math.max(1, Math.floor(h * DPR));
  ctx.setTransform(DPR,0,0,DPR,0,0);
}
window.addEventListener('resize', resize);
resize();

// grid settings
const GRID = 40;

// state
let gears = [];
let nextId = 1;
let running = false;
let lastTime = null;

// UI elements
const addBtn = document.getElementById('add-gear');
const startBtn = document.getElementById('start');
const stopBtn = document.getElementById('stop');
const gearListEl = document.getElementById('gear-list');
const inspector = document.getElementById('inspector');
const closeInspectorBtn = document.getElementById('close-inspector');
const inpDiameter = document.getElementById('inp-diameter');
const inpTeeth = document.getElementById('inp-teeth');
const inpDriver = document.getElementById('inp-driver');
const inpRpm = document.getElementById('inp-rpm');
const saveGearBtn = document.getElementById('save-gear');
const deleteGearBtn = document.getElementById('delete-gear');
const labelRpm = document.getElementById('label-rpm');
const toast = document.getElementById('toast');

function toastMsg(t){
  toast.textContent = t;
  toast.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(()=>toast.classList.add('hidden'),1500);
}

function snapToGrid(x){ return Math.round(x / GRID) * GRID; }
function snapToGridY(y){ return Math.round(y / GRID) * GRID; }

function addGearAt(x,y, snap=true){
  const diameter = 30;
  const teeth = 10;
  // ensure canvas bounds
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  let px = Math.max(diameter/2, Math.min(w - diameter/2, x));
  let py = Math.max(diameter/2, Math.min(h - diameter/2, y));
  if(snap){
    px = snapToGrid(px);
    py = snapToGridY(py);
  }

  // avoid overlapping existing gears by nudging if necessary
  const maxAttempts = 20;
  let attempt = 0;
  while(attempt < maxAttempts){
    let colliding = false;
    for(const other of gears){
      const dx = other.x - px;
      const dy = other.y - py;
      const dist = Math.hypot(dx,dy);
      const minDist = (other.diameter + diameter)/2 + 4;
      if(dist < minDist){
        colliding = true;
        // nudge to the right/down a grid step
        px += GRID * 0.5;
        py += GRID * 0.5;
        // clamp back inside canvas
        px = Math.max(diameter/2, Math.min(w - diameter/2, px));
        py = Math.max(diameter/2, Math.min(h - diameter/2, py));
        break;
      }
    }
    if(!colliding) break;
    attempt++;
  }

  const g = {
    id: nextId++,
    x: px,
    y: py,
    diameter,
    teeth,
    angle: 0,
    omega: 0, // rad/s
    rpm: 0,
    isDriver: false,
    dragging: false
  };
  gears.push(g);
  rebuildList();
}

addBtn.addEventListener('click', ()=> {
  // place in canvas center and avoid immediate overlap
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  addGearAt(w/2, h/2, true);
});

let clickTimer = null;

canvas.addEventListener('dblclick', (e)=>{
  // double-click should start dragging; cancel pending single-click inspector open
  if(clickTimer){ clearTimeout(clickTimer); clickTimer = null; }
  startDrag(e);
});

canvas.addEventListener('mousedown', (e)=>{
  const p = getMousePos(e);
  const g = findGearAt(p.x,p.y);
  if(g){
    // delay opening inspector to allow dblclick -> drag to take precedence
    if(clickTimer) clearTimeout(clickTimer);
    clickTimer = setTimeout(()=>{
      openInspectorFor(g);
      clickTimer = null;
    }, 220); // short delay
  }
});

canvas.addEventListener('touchstart', (e)=>{
  const t = e.touches[0];
  const rect = canvas.getBoundingClientRect();
  startDrag({clientX:t.clientX, clientY:t.clientY});
  e.preventDefault();
}, {passive:false});

function getMousePos(e){
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left),
    y: (e.clientY - rect.top)
  };
}

function findGearAt(x,y){
  for(let i=gears.length-1;i>=0;i--){
    const g = gears[i];
    const r = g.diameter/2;
    const dx = x - g.x;
    const dy = y - g.y;
    if(Math.hypot(dx,dy) <= r + 6) return g;
  }
  return null;
}

// Dragging logic: dblclick to start dragging; while mousemove update
let draggingGear = null;
let dragOffset = {x:0,y:0};
function startDrag(e){
  const p = getMousePos(e);
  const g = findGearAt(p.x,p.y);
  if(!g) return;
  draggingGear = g;
  dragOffset.x = p.x - g.x;
  dragOffset.y = p.y - g.y;
  g.dragging = true;
  canvas.style.cursor = 'grabbing';
  window.addEventListener('mousemove', onDrag);
  window.addEventListener('mouseup', endDrag);
}
function onDrag(e){
  if(!draggingGear) return;
  const p = getMousePos(e);
  // Free movement while dragging (ignore grid)
  draggingGear.x = (p.x - dragOffset.x);
  draggingGear.y = (p.y - dragOffset.y);
  rebuildList();
}
function endDrag(){
  if(draggingGear){
    draggingGear.dragging = false;

    // Auto-place beside nearby gear if released within 0.5 * GRID distance
    const threshold = GRID * 0.5;
    let nearest = null;
    let nearestDist = Infinity;
    for(const other of gears){
      if(other === draggingGear) continue;
      const dx = other.x - draggingGear.x;
      const dy = other.y - draggingGear.y;
      const d = Math.hypot(dx,dy);
      if(d < nearestDist){
        nearestDist = d;
        nearest = other;
      }
    }
    if(nearest && nearestDist <= threshold){
      // place dragged gear adjacent (touching) along line from nearest -> dragged
      const rA = draggingGear.diameter / 2;
      const rB = nearest.diameter / 2;
      let ux = draggingGear.x - nearest.x;
      let uy = draggingGear.y - nearest.y;
      const mag = Math.hypot(ux,uy);
      if(mag < 1e-6){
        // same center: nudge to the right
        ux = 1; uy = 0;
      } else {
        ux /= mag; uy /= mag;
      }
      const targetDist = rA + rB;
      draggingGear.x = nearest.x + ux * targetDist;
      draggingGear.y = nearest.y + uy * targetDist;
    }

    draggingGear = null;
  }
  canvas.style.cursor = 'grab';
  window.removeEventListener('mousemove', onDrag);
  window.removeEventListener('mouseup', endDrag);
  rebuildList();
}

// Inspector
let inspectedGear = null;
function openInspectorFor(g){
  inspectedGear = g;
  inspector.classList.remove('hidden');
  inspector.setAttribute('aria-hidden','false');
  inpDiameter.value = g.diameter;
  inpTeeth.value = g.teeth;
  inpDriver.checked = !!g.isDriver;
  inpRpm.value = g.isDriver ? (g.rpm || 0) : 0;
  // show/enable rpm only for driver
  labelRpm.style.display = g.isDriver ? 'block' : 'none';
  inpRpm.disabled = !g.isDriver;

  // ensure the driver checkbox toggles the rpm UI while inspector is open
  inpDriver.onchange = () => {
    const want = inpDriver.checked;
    labelRpm.style.display = want ? 'block' : 'none';
    inpRpm.disabled = !want;
    if(!want) inpRpm.value = 0;
  };
}
closeInspectorBtn.addEventListener('click', ()=>{ inspector.classList.add('hidden'); inspectedGear=null; inpDriver.onchange = null; });

saveGearBtn.addEventListener('click', ()=>{
  if(!inspectedGear) return;
  // enforce only one driver
  const wantDriver = inpDriver.checked;
  if(wantDriver){
    gears.forEach(gg=>{ if(gg !== inspectedGear) gg.isDriver = false; });
    inspectedGear.isDriver = true;
    inspectedGear.rpm = Number(inpRpm.value) || 0;
  } else {
    inspectedGear.isDriver = false;
    inspectedGear.rpm = 0;
  }
  inspectedGear.diameter = Math.max(8, Number(inpDiameter.value));
  inspectedGear.teeth = Math.max(4, Math.round(Number(inpTeeth.value)));
  inspector.classList.add('hidden');
  inspectedGear = null;
  rebuildList();
});

deleteGearBtn.addEventListener('click', ()=>{
  if(!inspectedGear) return;
  gears = gears.filter(g=>g !== inspectedGear);
  inspectedGear = null;
  inspector.classList.add('hidden');
  rebuildList();
});

// Start / Stop
startBtn.addEventListener('click', ()=>{ running = true; lastTime = performance.now(); toastMsg('Simulación iniciada'); loop(); });
stopBtn.addEventListener('click', ()=>{ running = false; toastMsg('Simulación detenida'); });

// Update list
function rebuildList(){
  gearListEl.innerHTML = '';
  gears.forEach(g=>{
    const div = document.createElement('div');
    div.className = 'gear-row';
    const left = document.createElement('div');
    left.innerHTML = `<strong>#${g.id}</strong> ${g.isDriver?'<span style="color:#0b8457">motriz</span>':''}`;
    const right = document.createElement('div');
    const rpmDisplay = (Math.abs(g.rpm)||Math.abs(radPerSecToRpm(g.omega)) ) ? Math.round(g.rpm || radPerSecToRpm(g.omega)) + ' rpm' : '0 rpm';
    right.textContent = `Ø${g.diameter}px · ${g.teeth}d · ${rpmDisplay}`;
    div.appendChild(left); div.appendChild(right);
    gearListEl.appendChild(div);
  });
  // update a single render so new/edited gears are visible immediately
  render();
}

// Physics: build graph of constraints each frame and compute omegas
function simulatePhysics(dt){
  // dt in seconds
  // First, set drivers' omega from rpm
  gears.forEach(g=>{
    if(g.isDriver){
      g.rpm = Number(g.rpm) || g.rpm || 0;
      g.omega = rpmToRadPerSec(g.rpm);
    } else {
      g.omega = 0; // will be computed
    }
  });

  // Build adjacency for meshing: if centers coincide -> same omega; if touching within tolerance -> meshed (inverted)
  const tol = 2; // px tolerance for contact
  const adj = new Map();
  gears.forEach(g=>adj.set(g.id,[]));
  for(let i=0;i<gears.length;i++){
    for(let j=i+1;j<gears.length;j++){
      const a = gears[i], b = gears[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx,dy);
      const rsum = (a.diameter + b.diameter)/2;
      if(d < 1e-6){
        // same center -> enforce same angular velocity (no sign inversion)
        adj.get(a.id).push({to:b, type:'coaxial'});
        adj.get(b.id).push({to:a, type:'coaxial'});
      } else if (Math.abs(d - rsum) <= tol){
        // touching -> mesh
        adj.get(a.id).push({to:b, type:'mesh'});
        adj.get(b.id).push({to:a, type:'mesh'});
      } else if (d < rsum + 2){ // allow slight overlap -> treat as mesh
        adj.get(a.id).push({to:b, type:'mesh'});
        adj.get(b.id).push({to:a, type:'mesh'});
      }
    }
  }

  // Propagate omegas from drivers through graph using BFS/DFS
  const visited = new Set();
  const queue = [];
  // initialize queue with drivers
  gears.forEach(g=>{
    if(g.isDriver){
      queue.push(g);
      visited.add(g.id);
    }
  });
  // If no driver, nothing to propagate
  while(queue.length){
    const cur = queue.shift();
    const neighbors = adj.get(cur.id) || [];
    neighbors.forEach(n=>{
      const nb = n.to;
      if(visited.has(nb.id)) return;
      if(n.type === 'coaxial'){
        // same omega
        nb.omega = cur.omega;
      } else if(n.type === 'mesh'){
        // omega ratio based on diameters: omega_nb = - omega_cur * (d_cur / d_nb)
        // (uses diameter ratio for exact speed calculation)
        nb.omega = - cur.omega * (cur.diameter / nb.diameter);
      }
      visited.add(nb.id);
      queue.push(nb);
    });
  }

  // At this point drivers have correct omega, connected components without drivers remain zero.
  // Convert omegas back to rpms for display
  gears.forEach(g=>{
    g.rpm = radPerSecToRpm(g.omega);
    // integrate angle
    g.angle += g.omega * dt;
  });
}

function rpmToRadPerSec(rpm){ return rpm * 2 * Math.PI / 60; }
function radPerSecToRpm(rad){ return rad * 60 / (2 * Math.PI); }

// Rendering
function drawGrid(){
  const w = canvas.clientWidth, h = canvas.clientHeight;
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0,0,w,h);
  // subtle grid
  ctx.strokeStyle = '#eef0ee';
  ctx.lineWidth = 1;
  for(let x=0;x<=w;x+=GRID){
    ctx.beginPath(); ctx.moveTo(x+0.5,0); ctx.lineTo(x+0.5,h); ctx.stroke();
  }
  for(let y=0;y<=h;y+=GRID){
    ctx.beginPath(); ctx.moveTo(0,y+0.5); ctx.lineTo(w,y+0.5); ctx.stroke();
  }
}

function drawGear(g){
  const r = g.diameter/2;
  const teeth = Math.max(4, g.teeth);
  ctx.save();
  ctx.translate(g.x, g.y);
  ctx.rotate(g.angle);

  // metal body with subtle gradient
  const grad = ctx.createLinearGradient(-r, -r, r, r);
  grad.addColorStop(0, '#e9edef');
  grad.addColorStop(0.6, '#d0d6d9');
  grad.addColorStop(1, '#bfc6c9');
  ctx.beginPath();
  ctx.fillStyle = grad;
  ctx.strokeStyle = '#5a5f60';
  ctx.lineWidth = Math.max(1, r*0.06);
  ctx.arc(0,0,r - Math.max(4,r*0.08),0,Math.PI*2);
  ctx.fill();
  ctx.stroke();

  // teeth: draw trapezoidal teeth around the rim for more realistic look
  const toothDepth = Math.min(8, r*0.28);
  const baseRadius = r - Math.max(4, r*0.08);
  const outerRadius = baseRadius + toothDepth;
  for(let i=0;i<teeth;i++){
    const a0 = (i/teeth) * Math.PI*2;
    const a1 = ((i+0.6)/teeth) * Math.PI*2;
    const a2 = ((i+0.4)/teeth) * Math.PI*2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a0)*baseRadius, Math.sin(a0)*baseRadius);
    ctx.lineTo(Math.cos(a1)*outerRadius, Math.sin(a1)*outerRadius);
    ctx.lineTo(Math.cos(a2)*outerRadius, Math.sin(a2)*outerRadius);
    ctx.lineTo(Math.cos(a0)*baseRadius, Math.sin(a0)*baseRadius);
    ctx.closePath();
    ctx.fillStyle = '#d7dde0';
    ctx.fill();
    ctx.strokeStyle = '#6a6f70';
    ctx.stroke();
  }

  // inner ring / hub
  ctx.beginPath();
  ctx.fillStyle = '#f2f4f5';
  ctx.arc(0,0,Math.max(4, r*0.35),0,Math.PI*2);
  ctx.fill();
  ctx.strokeStyle = '#888';
  ctx.lineWidth = 1;
  ctx.stroke();

  // center hole
  ctx.beginPath();
  ctx.fillStyle = '#9aa0a2';
  ctx.arc(0,0,Math.max(3, r*0.12),0,Math.PI*2);
  ctx.fill();

  // id text
  ctx.fillStyle = '#222';
  ctx.font = `${Math.max(10, Math.round(r*0.35))}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`#${g.id}`,0,0);

  // highlight if driver
  if(g.isDriver){
    ctx.beginPath();
    ctx.strokeStyle = '#0b8457';
    ctx.lineWidth = 2;
    ctx.arc(0,0,baseRadius-2,0,Math.PI*2);
    ctx.stroke();
  }

  ctx.restore();
}

function render(){
  // single-frame render (used when not animating continuously)
  drawGrid();
  ctx.lineWidth = 1;
  gears.forEach(g=>drawGear(g));
  gears.forEach(g=>{
    ctx.fillStyle = '#333';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(g.rpm)} rpm`, g.x, g.y + g.diameter/2 + 12);
  });
}

function loop(ts){
  if(!lastTime) lastTime = ts || performance.now();
  const now = ts || performance.now();
  const dt = Math.min(0.05, (now - lastTime) / 1000); // clamp dt
  lastTime = now;

  if(running) simulatePhysics(dt);

  // always draw current state
  render();

  // continue animation loop so motion is smooth when running
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

// Utility to show inspector when clicking on gear in list? Not required. But allow clicking list to center view.
gearListEl.addEventListener('click', (e)=>{
  const row = e.target.closest('.gear-row');
  if(!row) return;
  // find by id in text
  const idMatch = row.querySelector('strong')?.textContent;
  if(!idMatch) return;
  const id = Number(idMatch.replace('#',''));
  const g = gears.find(x=>x.id===id);
  if(g) {
    openInspectorFor(g);
  }
});

// Canvas initial placement: add a sample gear for convenience
