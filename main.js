(function(){
  const { Engine, Render, Runner, World, Bodies, Body, Composite, Composites, Events, Mouse, MouseConstraint, Vector } = Matter;

  const GRID = 30; // grid size in pixels
  let CANVAS_W = 640;
  let CANVAS_H = 480;
  const PLAY_MARGIN = 20;
  let sidebarRight = 0;

  const engine = Engine.create();
  // increase solver resolution to keep piece-to-piece and wall collisions stable
  engine.positionIterations = 30;
  engine.velocityIterations = 24;
  const world = engine.world;
  let effects = [];
  const consuming = [];
  world.gravity.y = 1.0;

  const canvas = document.getElementById('world');
  canvas.classList.add('grid');
  // current tool: 'PLACE' (default placing pieces) or 'ERASER'
  let currentTool = 'PLACE';

  function setTool(tool){
    currentTool = tool;
    if(tool === 'ERASER'){
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><rect rx="4" ry="4" x="4" y="10" width="20" height="12" fill="%23f28b82" stroke="%23c34" stroke-width="1"/><rect x="6" y="4" width="12" height="6" fill="%23fff"/></svg>';
      const data = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
      canvas.style.cursor = 'url("'+data+'") 14 14, auto';
    } else {
      canvas.style.cursor = 'grab';
    }
    document.querySelectorAll('.piece').forEach(b => {
      if(tool === 'ERASER') b.classList.toggle('selected', b.dataset.type === 'ERASER');
      else b.classList.remove('selected');
    });
  }

  // compute initial canvas pixel size from layout
  function computeCanvasSize(){
    // the physics play area begins immediately to the right of the fixed sidebar
    const sidebarEl = document.getElementById('sidebar');
    sidebarRight = 0;
    if(sidebarEl){
      const r = sidebarEl.getBoundingClientRect();
      sidebarRight = Math.max(0, Math.floor(r.right + 6));
    }
    canvas.style.left = sidebarRight + 'px';
    canvas.style.top = '0px';
    CANVAS_W = Math.max(200, window.innerWidth - sidebarRight);
    CANVAS_H = window.innerHeight;
    canvas.style.width = CANVAS_W + 'px';
    canvas.style.height = CANVAS_H + 'px';
  }
  computeCanvasSize();

  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;

  const render = Render.create({
    canvas: canvas,
    engine: engine,
    options: {
      width: CANVAS_W,
      height: CANVAS_H,
      wireframes: false,
      background: 'transparent',
      hasBounds: false
    }
  });
  Render.run(render);
  Events.on(render, 'afterRender', function(){
    const ctx = render.context;
    ctx.save();
    for (let i = effects.length - 1; i >= 0; i--) {
      const effect = effects[i];
      const alpha = Math.max(0, effect.life / effect.maxLife);
      const outerRadius = effect.radius * (1 + (1 - alpha) * 1.15);
      ctx.beginPath();
      ctx.arc(effect.x, effect.y, outerRadius, 0, Math.PI * 2);
      ctx.fillStyle = effect.color;
      ctx.globalAlpha = alpha * 0.2;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(effect.x, effect.y, effect.radius * (0.35 + (1 - alpha) * 0.85), 0, Math.PI * 2);
      ctx.lineWidth = 5;
      ctx.strokeStyle = effect.color;
      ctx.globalAlpha = alpha;
      ctx.stroke();

      effect.particles.forEach(p => {
        const dx = Math.cos(p.angle) * p.distance * (1 - alpha);
        const dy = Math.sin(p.angle) * p.distance * (1 - alpha);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = alpha;
        ctx.fillRect(effect.x + dx, effect.y + dy, p.size, p.size);
      });

      effect.life -= 0.03;
      if (effect.life <= 0) effects.splice(i, 1);
    }

    Composite.allBodies(world).forEach(b => {
      if(b.isPlatformerCharacter) {
        ctx.save();
        ctx.translate(b.position.x, b.position.y);
        ctx.globalAlpha = (b.render && b.render.opacity !== undefined) ? b.render.opacity : 1;
        ctx.fillStyle = '#e53935';
        ctx.fillRect(-12, -18, 24, 8);
        ctx.fillStyle = '#f5bd83';
        ctx.fillRect(-8, -10, 16, 10);
        ctx.fillStyle = '#2f6fce';
        ctx.fillRect(-10, 0, 20, 18);
        ctx.fillStyle = '#5b351f';
        ctx.fillRect(-10, 18, 8, 4);
        ctx.fillRect(2, 18, 8, 4);
        ctx.fillStyle = '#21180f';
        ctx.fillRect(4, -7, 3, 3);
        ctx.restore();
        return;
      }

      if(b.isCannon) {
        ctx.globalAlpha = 1;
        const angle = b.cannonAngle || 0;
        const barrelLength = 58;
        const muzzleX = b.position.x + Math.cos(angle) * barrelLength;
        const muzzleY = b.position.y + Math.sin(angle) * barrelLength;

        ctx.save();
        ctx.translate(b.position.x, b.position.y);
        ctx.rotate(angle);
        ctx.fillStyle = '#26384a';
        ctx.fillRect(-24, -16, 42, 32);
        ctx.fillStyle = '#5d7184';
        ctx.fillRect(-4, -10, 58, 20);
        ctx.fillStyle = '#172331';
        ctx.fillRect(38, -14, 20, 28);
        ctx.fillStyle = '#9fb4cc';
        ctx.fillRect(-18, 16, 30, 8);
        ctx.restore();

        ctx.beginPath();
        ctx.arc(muzzleX, muzzleY, 14, 0, Math.PI * 2);
        ctx.fillStyle = '#101923';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#8ea3b7';
        ctx.stroke();

        if(b.isAiming || b.isPreview) {
          ctx.save();
          ctx.setLineDash([8, 8]);
          ctx.beginPath();
          ctx.moveTo(muzzleX, muzzleY);
          ctx.lineTo(muzzleX + Math.cos(angle) * 220, muzzleY + Math.sin(angle) * 220);
          ctx.strokeStyle = 'rgba(255, 190, 90, 0.7)';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
        }
        return;
      }

      if(b.isBomb) {
        const r = b.circleRadius || 12;
        const fuseX = b.position.x + Math.cos(b.angle || 0) * r * 0.55;
        const fuseY = b.position.y + Math.sin(b.angle || 0) * r * 0.55 - r * 0.75;
        const tipX = fuseX + Math.cos((b.angle || 0) - 0.8) * 18;
        const tipY = fuseY + Math.sin((b.angle || 0) - 0.8) * 18;

        ctx.beginPath();
        ctx.moveTo(fuseX, fuseY);
        ctx.lineTo(tipX, tipY);
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#8b5a2b';
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(tipX, tipY, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#ffb347';
        ctx.fill();
        return;
      }

      // draw simple circle bodies (balls) explicitly so they remain visible
      if(b.label === 'ball' || b.isBall || b.label === 'Circle Body' || b.isFootball){
        const rx = (b.bounds.max.x - b.bounds.min.x) / 2;
        const ry = (b.bounds.max.y - b.bounds.min.y) / 2;
        ctx.beginPath();
        if(b.isFootball){
          ctx.ellipse(b.position.x, b.position.y, rx, ry, b.angle || 0, 0, Math.PI * 2);
        } else {
          const r = b.circleRadius || Math.max(4, rx, ry);
          ctx.arc(b.position.x, b.position.y, r, 0, Math.PI * 2);
        }
        ctx.fillStyle = (b.render && b.render.fillStyle) || '#6be0ff';
        ctx.globalAlpha = (b.render && b.render.opacity) || 1;
        ctx.fill();
        ctx.lineWidth = (b.render && b.render.lineWidth) || 2;
        if(b.render && b.render.strokeStyle){ ctx.strokeStyle = b.render.strokeStyle; ctx.stroke(); }
        // if it's a football (soccer/oval), draw simple dark patches
        if(b.isFootball){
          ctx.save();
          ctx.fillStyle = '#000000';
          const baseR = Math.max(rx, ry);
          const patchR = Math.max(2, baseR * 0.16);
          const angles = [0, Math.PI*2/5, -Math.PI*2/5, Math.PI*4/5, -Math.PI*4/5];
          angles.forEach(ang => {
            const px = b.position.x + Math.cos(ang) * rx * 0.65;
            const py = b.position.y + Math.sin(ang) * ry * 0.65;
            ctx.beginPath(); ctx.ellipse(px, py, patchR, patchR * (ry/rx || 1), 0, 0, Math.PI*2); ctx.fill();
          });
          ctx.restore();
        }
        // if it's a basketball, draw typical seam lines and pebbled dots
        if(b.isBall){
          ctx.save();
          ctx.globalAlpha = 1.0;
          ctx.strokeStyle = '#0b0b0b';
          ctx.lineWidth = Math.max(1, Math.round(r * 0.09));
          // central vertical seam (ellipse)
          ctx.beginPath();
          ctx.ellipse(b.position.x, b.position.y, r * 0.9, r * 0.5, Math.PI/2, 0, Math.PI * 2);
          ctx.stroke();
          // central horizontal seam
          ctx.beginPath();
          ctx.ellipse(b.position.x, b.position.y, r * 0.9, r * 0.5, 0, 0, Math.PI * 2);
          ctx.stroke();
          // curved panel seams left/right
          ctx.beginPath(); ctx.arc(b.position.x - r*0.35, b.position.y, r*0.45, -Math.PI/2, Math.PI/2); ctx.stroke();
          ctx.beginPath(); ctx.arc(b.position.x + r*0.35, b.position.y, r*0.45, Math.PI/2, -Math.PI/2); ctx.stroke();
          // pebbled texture: draw small dots around surface
          ctx.fillStyle = 'rgba(0,0,0,0.07)';
          const dotCount = Math.max(18, Math.round(r * 2.5));
          for(let i=0;i<dotCount;i++){
            const ang = (i / dotCount) * Math.PI * 2 + (i%3)*0.07;
            const rad = r * (0.6 + (i%6)/20);
            const dx = Math.cos(ang) * rad;
            const dy = Math.sin(ang) * rad;
            ctx.beginPath(); ctx.arc(b.position.x + dx, b.position.y + dy, Math.max(0.8, r*0.035), 0, Math.PI*2); ctx.fill();
          }
          ctx.restore();
        }
        return;
      }

      if(!b.isPiece || b.isRagdoll) return;

      ctx.save();
      ctx.translate(b.position.x, b.position.y);
      ctx.rotate(b.angle);
      ctx.globalAlpha = (b.render && b.render.opacity !== undefined) ? b.render.opacity : 1;
      b.pieceCells.forEach(cell => {
        const x = cell.x;
        const y = cell.y;
        ctx.fillStyle = b.pieceColor;
        ctx.fillRect(x - cell.size/2, y - cell.size/2, cell.size, cell.size);
      });
      ctx.restore();
    });

    ctx.restore();
  });
  const runner = Runner.create();
  Runner.run(runner, engine);

  // play area boundaries (created in function so we can recreate on resize)
  const wallOptions = { isStatic: true, render: { fillStyle: '#072133' }, restitution: 0.0, friction: 0.3, slop: 0.02 };
  const WALL_THICK = PLAY_MARGIN * 2;
  let walls = [];
  function createWalls(){
    if(walls && walls.length) World.remove(world, walls);
    const playableWidth = Math.max(50, CANVAS_W);
    const leftX = WALL_THICK / 2;
    const rightX = CANVAS_W - WALL_THICK / 2;
    const centerX = playableWidth / 2;
    const floorWidth = Math.max(10, playableWidth - 2 * PLAY_MARGIN);
    const leftWall = Bodies.rectangle(leftX, CANVAS_H/2, WALL_THICK, CANVAS_H, wallOptions);
    leftWall.wallSide = 'left';
    leftWall.label = 'left-wall';
    const rightWall = Bodies.rectangle(rightX, CANVAS_H/2, WALL_THICK, CANVAS_H, wallOptions);
    rightWall.wallSide = 'right';
    rightWall.label = 'right-wall';
    const floor = Bodies.rectangle(centerX, CANVAS_H - WALL_THICK / 2, floorWidth, WALL_THICK, wallOptions);
    floor.wallSide = 'bottom';
    floor.label = 'floor';
    const ceiling = Bodies.rectangle(centerX, WALL_THICK / 2, floorWidth, WALL_THICK, wallOptions);
    ceiling.wallSide = 'top';
    ceiling.label = 'ceiling';
    walls = [leftWall, rightWall, floor, ceiling];
    World.add(world, walls);
  }
  createWalls();

  // let Matter.js resolve the walls and piece collisions without custom overrides

  // add mouse control for interacting with placed bodies
  const mouse = Mouse.create(render.canvas);
  const mouseConstraint = MouseConstraint.create(engine, {
    mouse: mouse,
    constraint: { stiffness: 0.2, render: { visible: false } }
  });
  World.add(world, mouseConstraint);

  // allow using scroll wheel to rotate the active preview
  canvas.addEventListener('wheel', function(e){
    if(!active) return;
    e.preventDefault();
    const dir = e.deltaY > 0 ? 1 : -1;
    rotateActive(dir);
  }, { passive: false });

  // piece templates: tetromino-like shapes composed of blocks (GRID-sized squares)
  const TEMPLATES = {
    I: [{x: -1.5, y: 0},{x: -0.5,y:0},{x:0.5,y:0},{x:1.5,y:0}],
    O: [{x:-0.5,y:-0.5},{x:0.5,y:-0.5},{x:-0.5,y:0.5},{x:0.5,y:0.5}],
    T: [{x:-1,y:0},{x:0,y:0},{x:1,y:0},{x:0,y:1}],
    L: [{x:-1,y:-1},{x:-1,y:0},{x:-1,y:1},{x:0,y:1}],
    J: [{x:1,y:-1},{x:1,y:0},{x:1,y:1},{x:0,y:1}],
    S: [{x:-1,y:0},{x:0,y:0},{x:0,y:1},{x:1,y:1}],
    Z: [{x:-1,y:1},{x:0,y:1},{x:0,y:0},{x:1,y:0}]
  };

  const COLORS = {
    I: '#00d8ff',
    O: '#ffd43b',
    T: '#b36bff',
    L: '#ff8c4b',
    J: '#4bc8ff',
    S: '#5ee07b',
    Z: '#ff5e6c'
  };

  function createBomb(x, y, opts = {}){
    const b = Bodies.circle(x, y, GRID * 0.8, {
      label: 'bomb',
      density: 0.002,
      restitution: 0.1,
      friction: 0.2,
      render: { fillStyle: '#111111', strokeStyle: '#2b2b2b', lineWidth: 3 }
    });
    b.isBomb = true;
    return b;
  }

  function createBall(x, y, opts = {}){
    const r = (opts.radius || GRID * 0.6);
    const bouncinessEl = document.getElementById('ballBounciness');
    const defaultRest = 0.9;
    const rest = opts.restitution !== undefined ? opts.restitution : (bouncinessEl ? Math.min(1, (parseFloat(bouncinessEl.value) || (defaultRest*100)) / 100) : defaultRest);
    const b = Bodies.circle(x, y, r, {
      label: 'ball',
      density: 0.002,
      restitution: rest,
      friction: 0.02,
      frictionAir: 0.01,
      render: { fillStyle: '#d35400', strokeStyle: '#111111', lineWidth: 2 }
    });
    b.isBall = true;
    return b;
  }

  function createHoop(x, y, opts = {}){
    // Replace hoop with a soccer/football goal: two posts + crossbar and a dynamic net
    // Posts and crossbar are static and white; net is dynamic and attached to crossbar
    const postHeight = 90;
    const postThickness = 8;
    const halfWidth = 70;
    const leftPost = Bodies.rectangle(x - halfWidth, y + postHeight/2 - 8, postThickness, postHeight, { isStatic: true, label: 'goal-post', render: { fillStyle: '#000000' } });
    const rightPost = Bodies.rectangle(x + halfWidth, y + postHeight/2 - 8, postThickness, postHeight, { isStatic: true, label: 'goal-post', render: { fillStyle: '#000000' } });
    const crossbar = Bodies.rectangle(x, y - 8, halfWidth * 2 + 4, postThickness, { isStatic: true, label: 'goal-crossbar', render: { fillStyle: '#000000' } });
    leftPost.isHoopStatic = rightPost.isHoopStatic = crossbar.isHoopStatic = true;
    leftPost.isHoopPart = rightPost.isHoopPart = crossbar.isHoopPart = true;
    // ensure collisions enabled
    leftPost.collisionFilter = { group:0, category:0x0001, mask:0xFFFFFFFF };
    rightPost.collisionFilter = { group:0, category:0x0001, mask:0xFFFFFFFF };
    crossbar.collisionFilter = { group:0, category:0x0001, mask:0xFFFFFFFF };

    // build a simple net: a grid of small dynamic circles connected with constraints
    const netCols = 8;
    const netRows = 6;
    const spacing = 12;
    const netBodies = [];
    const constraints = [];
    const Constraint = Matter.Constraint;
    for(let col=0; col<netCols; col++){
      for(let row=0; row<netRows; row++){
        const nx = x + (col - (netCols-1)/2) * spacing;
        const ny = y + 20 + row * spacing;
        const nb = Bodies.circle(nx, ny, 3, { label: 'goal-net', density: 0.0006, friction: 0.2, restitution: 0.1, render: { fillStyle: '#000000' } });
        nb.isHoopStatic = false;
        netBodies.push(nb);
        // horizontal constraint to left neighbor
        if(col > 0){
          const leftIdx = (col - 1) * netRows + row;
          const left = netBodies[leftIdx];
          if(left) constraints.push(Constraint.create({ bodyA: left, bodyB: nb, length: spacing, stiffness: 0.5 }));
        }
        // vertical constraint to top neighbor
        if(row > 0){
          const topIdx = col * netRows + (row - 1);
          const topBody = netBodies[topIdx];
          if(topBody) constraints.push(Constraint.create({ bodyA: topBody, bodyB: nb, length: spacing, stiffness: 0.5 }));
        }
      }
    }

    // attach top row of net to crossbar
    for(let c=0;c<netCols;c++){
      const topBody = netBodies[c * netRows + 0];
      const attachX = x + (c - (netCols-1)/2) * spacing;
      constraints.push(Constraint.create({ bodyA: crossbar, pointA: { x: attachX - crossbar.position.x, y: 0 }, bodyB: topBody, length: spacing*0.6, stiffness: 0.9 }));
    }
    const comp = Composite.create({ bodies: [leftPost, rightPost, crossbar].concat(netBodies), constraints: constraints });
    comp.isHoop = true;
    return comp;
  }

  function createFootball(x, y, opts = {}){
    const r = (opts.radius || GRID * 0.6);
    const b = Bodies.circle(x, y, r, {
      label: 'football',
      density: 0.002,
      restitution: 0.6,
      friction: 0.02,
      frictionAir: 0.01,
      render: { fillStyle: '#ffffff', strokeStyle: '#000000', lineWidth: 2 }
    });
    // scale the circular body to an oval (ellipse) shape
    Body.scale(b, 1.6, 1.0);
    b.isFootball = true;
    return b;
  }

  function createCannon(x, y, opts = {}){
    const b = Bodies.rectangle(x, y, 46, 34, {
      label: 'cannon',
      isStatic: true,
      render: { visible: false }
    });
    b.isCannon = true;
    b.alwaysStatic = true;
    b.cannonAngle = opts.angle !== undefined ? opts.angle : -Math.PI / 4;
    b.cannonCooldown = 0;
    b.cannonLoadedBody = null;
    return b;
  }

  function createPlatform(x, y, width){
    const b = Bodies.rectangle(x, y, width, 18, {
      label: 'platform',
      isStatic: true,
      restitution: 0.1,
      friction: 0.8,
      render: { fillStyle: '#d08b52', strokeStyle: '#f2c38b', lineWidth: 2 }
    });
    b.isPlatform = true;
    b.alwaysStatic = true;
    return b;
  }

  function fireCannon(cannon, projectile){
    if(!cannon || !projectile || cannon.cannonLoadedBody !== projectile) return;
    if(Composite.allBodies(world).indexOf(projectile) === -1){
      cannon.cannonLoadedBody = null;
      return;
    }

    const angle = cannon.cannonAngle || 0;
    const direction = { x: Math.cos(angle), y: Math.sin(angle) };
    const muzzle = {
      x: cannon.position.x + direction.x * 58,
      y: cannon.position.y + direction.y * 58
    };
    Body.setStatic(projectile, false);
    projectile.isCannonLoaded = false;
    projectile.isPreview = false;
    projectile.render.opacity = 1;
    if(projectile.collisionFilter) projectile.collisionFilter.mask = 0xFFFFFFFF;
    Body.setPosition(projectile, {
      x: muzzle.x + direction.x * 22,
      y: muzzle.y + direction.y * 22
    });
    Body.setVelocity(projectile, {
      x: direction.x * 18,
      y: direction.y * 18
    });
    Body.setAngularVelocity(projectile, 0);
    cannon.cannonLoadedBody = null;
    cannon.cannonCooldown = 30;
  }

  // Black hole feature removed

  function addExplosionEffect(x, y, radius, color) {
    const particles = Array.from({ length: 28 }, () => ({
      angle: Math.random() * Math.PI * 2,
      distance: Math.random() * radius * 0.8,
      size: 2 + Math.random() * 4,
      color: Math.random() > 0.5 ? '#fff4c7' : color
    }));
    effects.push({ x, y, radius, color, life: 1, maxLife: 1, particles });
  }

  function createPlatformerCharacter(x, y){
    const b = Bodies.rectangle(x, y, 24, 44, {
      label: 'platformer-character',
      density: 0.002,
      friction: 0.001,
      frictionAir: 0.08,
      restitution: 0,
      render: { visible: false }
    });
    b.isPlatformerCharacter = true;
    b.platformerGrounded = false;
    b.platformerJumpQueued = false;
    return b;
  }

  function createPieceBody(type, px, py, opts = {}){
    if(type === 'BOMB') return createBomb(px, py, opts);
    if(type === 'BALL') return createBall(px, py, opts);
    if(type === 'FOOTBALL') return createFootball(px, py, opts);
    if(type === 'HOOP') return createHoop(px, py, opts);
    if(type === 'CANNON') return createCannon(px, py, opts);
    if(type === 'PLATFORMER') return createPlatformerCharacter(px, py, opts);
    if(type === 'PLATFORM_SMALL') return createPlatform(px, py, 120);
    if(type === 'PLATFORM_MEDIUM') return createPlatform(px, py, 220);
    if(type === 'PLATFORM_LARGE') return createPlatform(px, py, 340);

    const color = COLORS[type] || '#3c93b3';
    const cells = TEMPLATES[type].map(p => ({ x: p.x, y: p.y }));
    const centerX = cells.reduce((sum, cell) => sum + cell.x, 0) / cells.length;
    const centerY = cells.reduce((sum, cell) => sum + cell.y, 0) / cells.length;

    const localPoints = cells.flatMap(cell => {
      const x = (cell.x - centerX) * GRID;
      const y = (cell.y - centerY) * GRID;
      const half = (GRID - 4) / 2;
      return [
        { x: x - half, y: y - half },
        { x: x + half, y: y - half },
        { x: x + half, y: y + half },
        { x: x - half, y: y + half }
      ];
    });

    const hull = Matter.Vertices.hull(localPoints);
    const body = Bodies.fromVertices(px, py, [hull], {
      label: 'piece-body',
      friction: 0.25,
      density: 0.0016,
      restitution: 0.05,
      slop: 0.01,
      render: {
        visible: true,
        fillStyle: 'transparent',
        strokeStyle: 'transparent'
      }
    });

    body.isPiece = true;
    body.pieceType = type;
    body.pieceColor = color;
    body.pieceCells = cells.map(cell => ({
      x: (cell.x - centerX) * GRID,
      y: (cell.y - centerY) * GRID,
      size: GRID - 4
    }));
    return body;
  }

  // UI interactions: create a piece that follows mouse until dropped
  let active = null; // { body, type }
  let pending = null; // when drag starts outside canvas, hold { type }
  let aimingCannon = null;
  let playerCharacter = null;
  const controlKeys = { left: false, right: false };

  function startPreview(type, clientX, clientY){
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    // only create immediately if inside canvas; otherwise set pending and wait until pointer enters
    if(x < 0 || y < 0 || x > CANVAS_W || y > CANVAS_H){
      pending = { type };
      return;
    }
    const created = createPieceBody(type, x, y, {});
    // composite vs body handling: treat any composite (has .bodies) as a multi-body preview
    if(created && created.bodies){
      const comp = created;
      // set all bodies static for preview
      const bodies = Composite.allBodies(comp);
      bodies.forEach(b => {
        Body.setStatic(b, true);
        b.isPreview = true;
        b.render && (b.render.opacity = 0.85);
        // for hoops, keep collisions enabled so rim/backboard interact with balls;
        // rely on the mouseConstraint startdrag handler to prevent grabbing
        if(!comp.isHoop){
          if(!b.collisionFilter) b.collisionFilter = { group: 0, category: 0x0001, mask: 0 };
          else b.collisionFilter.mask = 0;
        }
      });
      World.add(world, comp);
      active = { body: comp, type };
      // ensure any existing mouse grab is released so preview won't stick
      releaseMouseGrab();
    } else {
      const b = created;
      Body.setPosition(b, { x, y });
      Body.setAngle(b, 0);
      Body.setStatic(b, true);
      b.isPreview = true;
      b.render.opacity = 0.85;
      if(!b.collisionFilter) b.collisionFilter = { group: 0, category: 0x0001, mask: 0 };
      else b.collisionFilter.mask = 0;
      World.add(world, b);
      active = { body: b, type };
      releaseMouseGrab();
    }
  }

  // when pending preview exists, create it once pointer enters canvas
  function tryCreatePending(clientX, clientY){
    if(!pending) return;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if(x >= 0 && y >= 0 && x <= CANVAS_W && y <= CANVAS_H){
      startPreview(pending.type, clientX, clientY);
      pending = null;
    }
  }

  function updatePreview(clientX, clientY){
    if(!active) return;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const clampBodyToWorld = (body) => {
      const bounds = body.bounds || { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
      const halfW = Math.max(0, (bounds.max.x - bounds.min.x) / 2);
      const halfH = Math.max(0, (bounds.max.y - bounds.min.y) / 2);
      const minX = PLAY_MARGIN + halfW;
      const maxX = CANVAS_W - PLAY_MARGIN - halfW;
      const minY = PLAY_MARGIN + halfH;
      const maxY = CANVAS_H - PLAY_MARGIN - halfH;
      const cx = Math.min(Math.max(x, minX), maxX);
      const cy = Math.min(Math.max(y, minY), maxY);
      Body.setPosition(body, { x: cx, y: cy });
    };

    // If preview is a composite (hoop, ragdoll), translate the composite centroid
    if(active.body && active.body.bodies){
      const bodies = Composite.allBodies(active.body);
      if(bodies.length){
        const avgX = bodies.reduce((s,b)=>s+b.position.x,0)/bodies.length;
        const avgY = bodies.reduce((s,b)=>s+b.position.y,0)/bodies.length;
        const dx = Math.min(Math.max(x - avgX, -240), 240);
        const dy = Math.min(Math.max(y - avgY, -240), 240);
        Composite.translate(active.body, { x: dx, y: dy });
        bodies.forEach(b => clampBodyToWorld(b));
      }
      return;
    }

    if(active.body.isRagdoll){
      const bodies = Composite.allBodies(active.body);
      if(bodies.length){
        const avgX = bodies.reduce((s,b)=>s+b.position.x,0)/bodies.length;
        const avgY = bodies.reduce((s,b)=>s+b.position.y,0)/bodies.length;
        const dx = Math.min(Math.max(x - avgX, -120), 120);
        const dy = Math.min(Math.max(y - avgY, -120), 120);
        Composite.translate(active.body, { x: dx, y: dy });
        bodies.forEach(b => clampBodyToWorld(b));
      }
      return;
    }

    clampBodyToWorld(active.body);
  }

  function rotateActive(dir = 1){
    if(!active) return;
    if(active.body.isCannon){
      active.body.cannonAngle = (active.body.cannonAngle || 0) + dir * Math.PI / 2;
    } else if(active.body.isRagdoll){
      // rotate each body around composite centroid
      const bodies = Composite.allBodies(active.body);
      if(bodies.length){
        const cx = bodies.reduce((s,b)=>s+b.position.x,0)/bodies.length;
        const cy = bodies.reduce((s,b)=>s+b.position.y,0)/bodies.length;
        bodies.forEach(b => { Body.rotate(b, dir * Math.PI/2, { x: cx, y: cy }); });
      }
    } else {
      Body.rotate(active.body, dir * Math.PI/2);
    }
  }

  function dropActive(){
    if(!active) return;
    const activeBodies = active.body && active.body.bodies ? Composite.allBodies(active.body) : [active.body];
    const pos = active.body.position || {
      x: activeBodies.reduce((sum, body) => sum + body.position.x, 0) / activeBodies.length,
      y: activeBodies.reduce((sum, body) => sum + body.position.y, 0) / activeBodies.length
    };
    const snapped = {
      x: Math.round((pos.x - PLAY_MARGIN) / GRID) * GRID + PLAY_MARGIN + GRID/2,
      y: Math.round((pos.y - PLAY_MARGIN) / GRID) * GRID + PLAY_MARGIN + GRID/2
    };
    const minX = PLAY_MARGIN + GRID/2;
    const maxX = CANVAS_W - PLAY_MARGIN - GRID/2;
    const minY = PLAY_MARGIN + GRID/2;
    const maxY = CANVAS_H - PLAY_MARGIN - GRID/2;
    snapped.x = Math.min(Math.max(snapped.x, minX), maxX);
    snapped.y = Math.min(Math.max(snapped.y, minY), maxY);

    // if composite (hoop or ragdoll), handle all bodies in composite
      if(active.body && active.body.bodies){
      const comp = active.body;
      const bodies = Composite.allBodies(comp);
      if(bodies.length){
        const avgX = bodies.reduce((s,b)=>s+b.position.x,0)/bodies.length;
        const avgY = bodies.reduce((s,b)=>s+b.position.y,0)/bodies.length;
        const dx = snapped.x - avgX;
        const dy = snapped.y - avgY;
        Composite.translate(comp, { x: dx, y: dy });
        bodies.forEach(b => {
          // For hoops, keep rim/backboard static and net nodes dynamic
          if(comp.isHoop){
            const shouldStatic = !!b.isHoopStatic;
            Body.setStatic(b, shouldStatic);
          } else {
            Body.setStatic(b, false);
          }
          b.isPreview = false;
          // restore collision so bodies interact normally; prevents mouse from grabbing hoops via startdrag handler
          if(b.collisionFilter) b.collisionFilter.mask = 0xFFFFFFFF;
          else b.collisionFilter = { group:0, category:0x0001, mask: 0xFFFFFFFF };
        });
      }
      World.add(world, comp);
      // release any mouseConstraint hold to avoid getting stuck to the hoop
      try{
        if(mouseConstraint && mouseConstraint.constraint) {
          mouseConstraint.constraint.bodyB = null;
        }
        if(mouseConstraint) mouseConstraint.body = null;
      } catch(e){}
    } else {
      Body.setPosition(active.body, snapped);
      // allow some pieces (hoop) to remain static when dropped
      if(!active.body.alwaysStatic) Body.setStatic(active.body, false);
      active.body.isPreview = false;
      if(!active.body.alwaysStatic){
        if(active.body.collisionFilter) active.body.collisionFilter.mask = 0xFFFFFFFF;
        else active.body.collisionFilter = { group:0, category:0x0001, mask:0xFFFFFFFF };
      } else {
        const shouldCollide = active.body.isPlatform || active.body.isCannon;
        if(active.body.collisionFilter) active.body.collisionFilter.mask = shouldCollide ? 0xFFFFFFFF : 0;
        else active.body.collisionFilter = { group:0, category:0x0001, mask: shouldCollide ? 0xFFFFFFFF : 0 };
      }
      Body.setVelocity(active.body, { x: 0, y: 0 });
      Body.setAngularVelocity(active.body, active.body.angularVelocity * 0.2);
      if(active.body.isPlatformerCharacter){
        playerCharacter = active.body;
        Body.setAngle(playerCharacter, 0);
      }
      if(active.type === 'BOMB'){
        const droppedBody = active.body;
        setTimeout(() => { tryExplodeAtBody(droppedBody); }, 1200);
      }
    }
    active = null;
  }

  // wire up sidebar buttons
  document.querySelectorAll('.piece').forEach(btn => {
    btn.addEventListener('mousedown', e => {
      // prevent default browser drag/select behavior which can interfere with mouseup
      e.preventDefault();
      e.stopPropagation();
      const type = btn.dataset.type;
      if(type === 'ERASER'){
        setTool('ERASER');
        return;
      }
      // selecting a piece returns to place mode
      setTool('PLACE');
      startPreview(type, e.clientX, e.clientY);
    });
  });

  // follow mouse when previewing
  window.addEventListener('mousemove', e => {
    tryCreatePending(e.clientX, e.clientY);
    updatePreview(e.clientX, e.clientY);
    if(aimingCannon){
      const rect = canvas.getBoundingClientRect();
      aimingCannon.cannonAngle = Math.atan2(
        e.clientY - rect.top - aimingCannon.position.y,
        e.clientX - rect.left - aimingCannon.position.x
      );
      aimingCannon.isAiming = true;
    }
  });

  // finish on mouseup
  window.addEventListener('mouseup', e => {
    // if we had a pending preview and mouseup outside canvas, just clear it
    pending = null;
    if(active) dropActive();
    if(aimingCannon) aimingCannon.isAiming = false;
    aimingCannon = null;
  });

  // pointerup covers more input types and is more reliable when dragging from other elements
  window.addEventListener('pointerup', e => {
    pending = null;
    if(active) {
      try { dropActive(); } catch(err){ active = null; }
    }
    releaseMouseGrab();
    if(aimingCannon) aimingCannon.isAiming = false;
    aimingCannon = null;
  });

  function releaseMouseGrab(){
    try{
      if(mouseConstraint){
        if(mouseConstraint.constraint) mouseConstraint.constraint.bodyB = null;
        mouseConstraint.body = null;
      }
    } catch(e){ }
  }

  // rotate with R
  window.addEventListener('keydown', e => {
    const key = e.key.toLowerCase();
    if(key === 'a' || key === 'arrowleft') controlKeys.left = true;
    if(key === 'd' || key === 'arrowright') controlKeys.right = true;
    if(key === 'w' || e.code === 'Space' || key === 'arrowup'){
      const player = playerCharacter;
      if(player) player.platformerJumpQueued = true;
      e.preventDefault();
    }
    if(key === 'r'){
      rotateActive(1);
    }
  });

  window.addEventListener('keyup', e => {
    const key = e.key.toLowerCase();
    if(key === 'a' || key === 'arrowleft') controlKeys.left = false;
    if(key === 'd' || key === 'arrowright') controlKeys.right = false;
  });

  // keep canvas responsive-ish
  function resizeCanvas(){
    // recompute canvas size from layout and update renderer and walls
    computeCanvasSize();
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    render.canvas.width = CANVAS_W;
    render.canvas.height = CANVAS_H;
    render.options.width = CANVAS_W;
    render.options.height = CANVAS_H;
    // recreate boundaries to match new size
    createWalls();
  }
  window.addEventListener('resize', resizeCanvas);

  // initial resize to apply fullscreen dimensions
  resizeCanvas();

  // prevent page scroll when mouse wheel is used over the canvas
  canvas.addEventListener('wheel', function(e){
    e.preventDefault();
  }, { passive: false });

  // rotate grabbed body with scroll wheel when dragging an existing object
  canvas.addEventListener('wheel', function(e){
    // if there's an active preview, let the preview handler manage rotation
    if(active) return;
    // find grabbed body from mouseConstraint (body or constraint.bodyB)
    const grabbed = (mouseConstraint && (mouseConstraint.body || (mouseConstraint.constraint && mouseConstraint.constraint.bodyB))) || null;
    if(!grabbed) return;
    if(grabbed.isStatic) return;
    e.preventDefault();
    const step = Math.PI / 12; // 15 degrees per wheel tick
    const dir = e.deltaY > 0 ? 1 : -1; // positive => clockwise

    // if body belongs to a composite with multiple bodies (ragdoll/hoop), rotate composite
    const allComps = Composite.allComposites(world);
    for(const comp of allComps){
      const bodies = Composite.allBodies(comp);
      if(bodies.indexOf(grabbed) !== -1 && bodies.length > 1){
        const cx = bodies.reduce((s,b)=>s+b.position.x,0)/bodies.length;
        const cy = bodies.reduce((s,b)=>s+b.position.y,0)/bodies.length;
        bodies.forEach(b => { try{ Body.rotate(b, dir * step, { x: cx, y: cy }); } catch(e){} });
        return;
      }
    }

    // otherwise rotate single body around its center
    try{ Body.rotate(grabbed, dir * step); } catch(e){}
  }, { passive: false });

  // helper to find body under point and trigger bomb
  function tryExplodeAtPoint(point){
    const all = Composite.allBodies(world);
    const found = Matter.Query.point(all, point);
    if(found && found.length){
      const b = found[0];
      if(b.isBomb){ tryExplodeAtBody(b); }
      else if(b.label === 'Circle Body' && b.isBomb){ tryExplodeAtBody(b); }
    }
  }

  function tryExplodeAtBody(b){
    if(!b || !b.isBomb) return;
    const pos = b.position;
    // reduce explosion radius and force to be less extreme
      // allow runtime bomb strength multiplier (percent)
      const strengthEl = document.getElementById('bombStrength');
      const strengthPercent = strengthEl ? (parseFloat(strengthEl.value) || 100) / 100 : 1.0;
      const R = 120 * strengthPercent;
      addExplosionEffect(pos.x, pos.y, R, '#ffb347');
    const bodies = Composite.allBodies(world);
    bodies.forEach(o => {
      if(o.isStatic || o === b) return;
      const dx = o.position.x - pos.x;
      const dy = o.position.y - pos.y;
      const dist = Math.sqrt(dx*dx+dy*dy) || 0.0001;
        if(dist > R) return;
        o.bombDragTimer = 12;
        const baseForce = 0.18;
        const forceMag = baseForce * strengthPercent * (1 - dist / R);
        const pushX = (dx / dist) * forceMag * 6;
        const pushY = ((dy / dist) * forceMag * 6) - (0.06 * strengthPercent);
      Body.applyForce(o, o.position, { x: pushX, y: pushY });
        Body.setVelocity(o, {
          x: Math.min(Math.max(o.velocity.x * (1 + 0.05 * strengthPercent), -12), 12),
          y: Math.min(Math.max(o.velocity.y * (1 + 0.05 * strengthPercent), -12), 12)
        });
    });
    // remove bomb
    World.remove(world, b);
  }

  // click to trigger bombs early
  function deleteBodyAtPoint(pt){
    const all = Composite.allBodies(world);
    const found = Matter.Query.point(all, pt);
    if(found && found.length){
      const b = found[0];
      // don't allow deleting play-area walls
      if(b.wallSide || b.isCannon) return;
      // if part of a ragdoll composite, remove the composite
      const allComps = Composite.allComposites(world);
      for(const comp of allComps){
        if(comp.isRagdoll || comp.isHoop){
          const bodies = Composite.allBodies(comp);
          if(bodies.indexOf(b) !== -1){ Composite.remove(world, comp); return; }
        }
      }
      if(b === playerCharacter) playerCharacter = null;
      World.remove(world, b);
    }
  }

  canvas.addEventListener('mousedown', function(e){
    const rect = canvas.getBoundingClientRect();
    const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const cannon = Composite.allBodies(world).find(b => b.isCannon && Matter.Query.point([b], pt).length);
    if(cannon){
      aimingCannon = cannon;
      cannon.isAiming = true;
      cannon.cannonAngle = Math.atan2(pt.y - cannon.position.y, pt.x - cannon.position.x);
      return;
    }
    if(currentTool === 'ERASER'){
      deleteBodyAtPoint(pt);
      return;
    }
    tryExplodeAtPoint(pt);
  });

  // fix: schedule explosion should capture body reference instead of using closed-over active
  function scheduleExplosionFor(body, delay){
    if(!body) return;
    setTimeout(() => { tryExplodeAtBody(body); }, delay);
  }

  // handle trash: remove active on drop into trash; also remove dragged bodies via mouseConstraint events
  const trashEl = document.getElementById('trash');
  function isPointInTrash(clientX, clientY){
    const r = trashEl.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }

  window.addEventListener('mouseup', function(e){
    if(isPointInTrash(e.clientX, e.clientY)){
      // if we had an active preview, remove it
      if(active){
        if(active.body.isRagdoll){ Composite.remove(world, active.body); }
        else World.remove(world, active.body);
        active = null;
      }
    }
  });

  // ensure mouse grab is released on any mouseup to avoid stuck bodies
  window.addEventListener('mouseup', function(){ releaseMouseGrab(); });

  Events.on(mouseConstraint, 'enddrag', function(ev){
    // ev.mouse is available; check if mouse is over trash
    const m = ev.mouse && ev.mouse.absolute;
    if(m && isPointInTrash(m.x, m.y) && ev.body){
      // if composite part dragged, remove whole composite if composite label present
      const b = ev.body;
      if(b.isCannon) return;
      if(b === playerCharacter) playerCharacter = null;
      // try remove composite parent if any
      // search composites to find one containing this body
      const allComps = Composite.allComposites(world);
      for(const comp of allComps){
        if(comp.isRagdoll || comp.isHoop){
          const bodies = Composite.allBodies(comp);
          if(bodies.indexOf(b) !== -1){ Composite.remove(world, comp); return; }
        }
      }
      World.remove(world, b);
    }
  });

  // Prevent dragging hoop parts: if a startdrag targets a body belonging to a hoop composite, immediately release it
  Events.on(mouseConstraint, 'startdrag', function(ev){
    const b = ev.body;
    if(!b) return;
    const allComps = Composite.allComposites(world);
    for(const comp of allComps){
      if(comp.isHoop){
        const bodies = Composite.allBodies(comp);
        if(bodies.indexOf(b) !== -1){
          // release immediately
          try{ if(mouseConstraint.constraint) mouseConstraint.constraint.bodyB = null; } catch(e){}
          try{ mouseConstraint.body = null; } catch(e){}
          return;
        }
      }
    }
  });

  // small helper to keep objects from drifting slowly: optional damping
  Events.on(engine, 'beforeUpdate', function(){
    Composite.allBodies(world).forEach(b => {
      if(b.isStatic) return;
      if(b.bombDragTimer > 0){
        b.frictionAir = 0.65;
        b.bombDragTimer -= 1;
      } else {
        b.frictionAir = 0.02;
      }
    });

    const player = playerCharacter;
    if(!player || player.isStatic || Composite.allBodies(world).indexOf(player) === -1) return;

    const playerBounds = player.bounds;
    const grounded = Composite.allBodies(world).some(other => {
      if(other === player || other.isPreview || other.isCannonLoaded || other.isCannon || other.isPlatformerCharacter) return false;
      const horizontalOverlap = playerBounds.max.x > other.bounds.min.x + 2 && playerBounds.min.x < other.bounds.max.x - 2;
      const standingOnTop = playerBounds.max.y >= other.bounds.min.y - 4 && playerBounds.max.y <= other.bounds.min.y + 12;
      return horizontalOverlap && standingOnTop;
    });
    player.platformerGrounded = grounded;

    if(player.platformerJumpQueued && grounded){
      Body.setVelocity(player, { x: player.velocity.x, y: -11 });
      player.platformerJumpQueued = false;
    }

    const direction = (controlKeys.right ? 1 : 0) - (controlKeys.left ? 1 : 0);
    const nextVelocityX = direction === 0
      ? player.velocity.x * 0.72
      : Math.max(-5.5, Math.min(5.5, player.velocity.x + direction * 0.8));
    Body.setVelocity(player, {
      x: nextVelocityX,
      y: Math.max(-14, Math.min(14, player.velocity.y))
    });
    Body.setAngle(player, 0);
    Body.setAngularVelocity(player, 0);
  });

  Events.on(engine, 'afterUpdate', function(){
    const bodies = Composite.allBodies(world);
    bodies.filter(b => b.isCannon).forEach(cannon => {
      if(cannon.cannonCooldown > 0){
        cannon.cannonCooldown -= 1;
        return;
      }

      const angle = cannon.cannonAngle || 0;
      const direction = { x: Math.cos(angle), y: Math.sin(angle) };
      const muzzle = {
        x: cannon.position.x + direction.x * 58,
        y: cannon.position.y + direction.y * 58
      };
      const projectile = bodies.find(body => {
        if(body === cannon || body.isStatic || body.isPreview || body.isCannon || body.isCannonLoaded || body.wallSide) return false;
        const dx = body.position.x - muzzle.x;
        const dy = body.position.y - muzzle.y;
        return dx * dx + dy * dy < 30 * 30;
      });

      if(projectile){
        cannon.cannonLoadedBody = projectile;
        projectile.isCannonLoaded = true;
        Body.setStatic(projectile, true);
        Body.setPosition(projectile, muzzle);
        Body.setVelocity(projectile, { x: 0, y: 0 });
        if(projectile.collisionFilter) projectile.collisionFilter.mask = 0;
        projectile.render.opacity = 0;
        setTimeout(() => fireCannon(cannon, projectile), 350);
      }
    });
  });

  // (black hole feature removed)

  // Prevent fast bodies from tunneling through walls by clamping them after physics step
  Events.on(engine, 'afterUpdate', function(){
    Composite.allBodies(world).forEach(b => {
      if(!b || b.isStatic || b.isPreview) return;
      const r = b.circleRadius || Math.max(4, (b.bounds.max.x - b.bounds.min.x) / 2);
      const minX = PLAY_MARGIN + r;
      const maxX = CANVAS_W - PLAY_MARGIN - r;
      const minY = PLAY_MARGIN + r;
      const maxY = CANVAS_H - PLAY_MARGIN - r;
      const px = b.position.x;
      const py = b.position.y;
      const vx = (b.velocity && b.velocity.x) || 0;
      const vy = (b.velocity && b.velocity.y) || 0;
      const wasBombed = b.bombDragTimer > 0;
      const dampFactor = wasBombed ? 0.75 : 0.9;
      const reflectFactor = wasBombed ? 0.6 : 0.4;

      if(px < minX){
        Body.setPosition(b, { x: minX, y: py });
        Body.setVelocity(b, { x: Math.abs(vx) * reflectFactor, y: vy * dampFactor });
        Body.setAngularVelocity(b, b.angularVelocity * dampFactor);
      }
      if(px > maxX){
        Body.setPosition(b, { x: maxX, y: py });
        Body.setVelocity(b, { x: -Math.abs(vx) * reflectFactor, y: vy * dampFactor });
        Body.setAngularVelocity(b, b.angularVelocity * dampFactor);
      }
      if(py < minY){
        Body.setPosition(b, { x: px, y: minY });
        Body.setVelocity(b, { x: vx * dampFactor, y: Math.abs(vy) * reflectFactor });
        Body.setAngularVelocity(b, b.angularVelocity * dampFactor);
      }
      if(py > maxY){
        Body.setPosition(b, { x: px, y: maxY });
        Body.setVelocity(b, { x: vx * dampFactor, y: -Math.abs(vy) * reflectFactor });
        Body.setAngularVelocity(b, b.angularVelocity * dampFactor);
      }
    });

    // cleanup: remove non-static bodies that are far outside the play area to save simulation work
    Composite.allBodies(world).forEach(b => {
      if(!b || b.isStatic || b.isPreview) return;
      const px = b.position.x;
      const py = b.position.y;
      const margin = 200; // pixels outside bounds before removal
      if(px < -margin || px > CANVAS_W + margin || py < -margin || py > CANVAS_H + margin){
        // protect bombs and hoops from accidental removal
        if(b.isBomb) { World.remove(world, b); return; }
        // if part of a composite (hoop/ragdoll), remove the composite
        const allComps = Composite.allComposites(world);
        for(const comp of allComps){
          if((comp.isRagdoll || comp.isHoop)){
            const bodies = Composite.allBodies(comp);
            if(bodies.indexOf(b) !== -1){ Composite.remove(world, comp); return; }
          }
        }
        World.remove(world, b);
      }
    });
  });

  // afterUpdate: animate consuming bodies toward their hole and remove when done
  Events.on(engine, 'afterUpdate', function(){
    if(consuming.length === 0) return;
    for(let i = consuming.length - 1; i >= 0; i--){
      const item = consuming[i];
      const b = item.body;
      const hole = item.hole;
      if(!b || !hole){ consuming.splice(i,1); continue; }
      // compute vector toward hole center
      const dx = hole.position.x - b.position.x;
      const dy = hole.position.y - b.position.y;
      const dist = Math.sqrt(dx*dx + dy*dy) || 0.0001;
      // move a fraction of the remaining distance (smooth approach)
      const step = Math.min(8, Math.max(0.8, dist * 0.22));
      const nx = dx / dist, ny = dy / dist;
      const tx = nx * step, ty = ny * step;
      try{ Body.translate(b, { x: tx, y: ty }); } catch(e){}
      // damp velocity to keep it steady
      try{ Body.setVelocity(b, { x: (b.velocity.x || 0) * 0.2, y: (b.velocity.y || 0) * 0.2 }); } catch(e){}
      // fade out render opacity progressively
      if(b.render){
        b.render.opacity = Math.max(0, (b.render.opacity || 1) - 0.08);
      }
      // when close enough, remove (and remove composite parents)
      if(dist < 6 || (b.render && b.render.opacity <= 0.02)){
        addExplosionEffect(hole.position.x, hole.position.y, 18, '#000000');
        const allComps = Composite.allComposites(world);
        let removed = false;
        for(const comp of allComps){
          if((comp.isRagdoll || comp.isHoop)){
            const bodiesInComp = Composite.allBodies(comp);
            if(bodiesInComp.indexOf(b) !== -1){ try{ Composite.remove(world, comp); } catch(e){} removed = true; break; }
          }
        }
        if(!removed){ try{ World.remove(world, b); } catch(e){} }
        consuming.splice(i,1);
      }
    }
  });

  // spawn all regular objects at the start, excluding the stickman
  const starterTypes = ['I', 'O', 'T', 'L', 'J', 'S', 'Z', 'BOMB'];
  const starterPositions = [
    { x: 150, y: 110 },
    { x: 260, y: 110 },
    { x: 370, y: 110 },
    { x: 480, y: 110 },
    { x: 170, y: 220 },
    { x: 280, y: 220 },
    { x: 390, y: 220 },
    { x: 500, y: 220 }
  ];

  starterTypes.forEach((type, index) => {
    const pos = starterPositions[index] || { x: 150 + (index * 70) % 300, y: 110 + Math.floor(index / 4) * 110 };
    const body = createPieceBody(type, pos.x, pos.y, {});
    if(body && !body.isRagdoll) {
      Body.setVelocity(body, { x: 0, y: 0 });
      Body.setAngularVelocity(body, 0);
      World.add(world, body);
    }
  });

  // Start with one playable character already in the scene.
  const spawnedPlayer = createPlatformerCharacter(PLAY_MARGIN + 80, CANVAS_H - WALL_THICK - 24);
  World.add(world, spawnedPlayer);
  playerCharacter = spawnedPlayer;

})();