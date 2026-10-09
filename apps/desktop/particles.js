/**
 * Tiny canvas particle engine for character effects: floating "z"s while
 * sleeping, thought bubbles, confetti, sparkles, hearts, reminder rings, puffs.
 *
 * The animation loop only runs while particles exist or an emitter is active,
 * so an idle Pebble costs no CPU. Exposes window.Particles.
 */
(function (root) {
  const GOLD = '#FFC93C';
  const CONFETTI = ['#FF5A7A', '#FFC93C', '#4FD1C5', '#6E8BFF', '#B57BFF', '#7ED957'];

  function create(canvas, getAnchor) {
    const ctx = canvas.getContext('2d');
    const particles = [];
    let emitters = [];
    let enabled = true;
    let running = false;
    let last = 0;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    window.addEventListener('resize', resize);
    resize();

    const rand = (a, b) => a + Math.random() * (b - a);

    function spawn(p) {
      if (!enabled) return;
      particles.push({ vx: 0, vy: 0, ay: 0, rot: 0, vr: 0, grow: 0, age: 0, alpha: 1, ...p });
      start();
    }

    // ---------- particle recipes ----------
    const recipes = {
      zzz(a) {
        spawn({ kind: 'glyph', glyph: Math.random() < 0.5 ? 'z' : 'Z', color: '#7FB2FF', x: a.headX + 30, y: a.headY, vx: rand(10, 22), vy: rand(-28, -20), size: rand(14, 20), grow: 6, life: 2.6 });
      },
      thought(a) {
        spawn({ kind: 'bubble', x: a.headX + rand(18, 34), y: a.headY - 4, vx: rand(4, 12), vy: rand(-30, -22), size: rand(3, 7), grow: 2.5, life: 1.8 });
      },
      twinkle(a) {
        spawn({ kind: 'glyph', glyph: '✦', color: GOLD, x: a.cx + rand(-90, 90), y: a.cy + rand(-90, 40), size: rand(8, 13), life: 1.2, vr: rand(-2, 2) });
      },
      sparkles(a, n = 8) {
        for (let i = 0; i < n; i++) {
          const angle = (i / n) * Math.PI * 2 + rand(-0.3, 0.3);
          const speed = rand(60, 110);
          spawn({ kind: 'glyph', glyph: '✦', color: GOLD, x: a.headX, y: a.headY + 10, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 20, ay: 60, size: rand(9, 15), life: 0.9, vr: rand(-4, 4) });
        }
      },
      confetti(a, n = 42) {
        for (let i = 0; i < n; i++) {
          spawn({
            kind: 'rect', color: CONFETTI[i % CONFETTI.length],
            x: a.cx + rand(-30, 30), y: a.headY,
            vx: rand(-130, 130), vy: rand(-260, -150), ay: 420,
            size: rand(5, 9), life: rand(1.4, 2), rot: rand(0, 6), vr: rand(-10, 10),
          });
        }
      },
      hearts(a, n = 5) {
        for (let i = 0; i < n; i++) {
          spawn({ kind: 'glyph', glyph: '❤', color: '#FF5A7A', x: a.cx + rand(-50, 50), y: a.cy + rand(-10, 30), vx: rand(-10, 10), vy: rand(-45, -30), size: rand(12, 20), life: rand(1.8, 2.4), delay: i * 0.15 });
        }
      },
      exclaim(a) {
        spawn({ kind: 'glyph', glyph: '!', color: '#FF8A00', x: a.headX + 36, y: a.headY - 10, vy: -12, size: 30, grow: 10, life: 1.1 });
        recipes.sparkles(a, 4);
      },
      ring(a) {
        spawn({ kind: 'ring', color: '#FFB020', x: a.cx, y: a.cy + 20, size: 30, grow: 80, life: 1.2 });
      },
      puff(a, n = 7) {
        for (let i = 0; i < n; i++) {
          spawn({ kind: 'circle', color: 'rgba(160,160,170,0.55)', x: a.headX + rand(-30, 30), y: a.headY + rand(-10, 10), vx: rand(-25, 25), vy: rand(-30, -10), size: rand(6, 10), grow: 14, life: 0.9 });
        }
      },
      notes(a) {
        const colors = ['#B57BFF', '#4FD1C5', '#6E8BFF', '#FF7AB6'];
        spawn({ kind: 'glyph', glyph: Math.random() < 0.5 ? '♪' : '♫', color: colors[Math.floor(Math.random() * colors.length)], x: a.cx + rand(-70, 70), y: a.headY + rand(0, 30), vx: rand(-12, 12), vy: rand(-38, -26), size: rand(15, 22), life: 2.2, vr: rand(-1, 1) });
      },
      dots(a) {
        spawn({ kind: 'circle', color: 'rgba(255,255,255,0.9)', x: a.headX + rand(-40, 40), y: a.headY + rand(-20, 0), vy: rand(-25, -15), size: rand(2, 3.5), life: 0.8 });
      },
    };

    // Continuous emitters per animation state: [recipe, every seconds]
    const STATE_EMITTERS = {
      sleep: [['zzz', 0.9]],
      thinking: [['thought', 0.45]],
      idle: [['twinkle', 3.5]],
      fidget: [['twinkle', 2.5]],
      talking: [['dots', 0.35]],
      reminder: [['ring', 1.1]],
      music: [['notes', 0.6]],
      search: [['twinkle', 1.2]],
      warning: [['ring', 1.1]],
    };
    // One-off bursts when a state starts
    const STATE_BURSTS = { greet: 'sparkles', success: 'confetti', curious: 'exclaim', error: 'puff' };

    function setState(state, pose) {
      emitters = (STATE_EMITTERS[state] || []).map(([recipe, every]) => ({ recipe, every, timer: every * 0.4 }));
      if (!enabled) return;
      const anchor = getAnchor();
      if (STATE_BURSTS[state]) recipes[STATE_BURSTS[state]](anchor);
      if (pose === 'love') recipes.hearts(anchor);
      if (emitters.length) start();
    }

    function setEnabled(value) {
      enabled = value;
      if (!enabled) {
        particles.length = 0;
        emitters = [];
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }

    // ---------- loop ----------
    function start() {
      if (running) return;
      running = true;
      last = performance.now();
      requestAnimationFrame(frame);
    }

    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const anchor = getAnchor();

      for (const e of emitters) {
        e.timer -= dt;
        if (e.timer <= 0) {
          e.timer = e.every;
          recipes[e.recipe](anchor);
        }
      }

      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        if (p.delay > 0) {
          p.delay -= dt;
          continue;
        }
        p.age += dt;
        if (p.age >= p.life) {
          particles.splice(i, 1);
          continue;
        }
        p.vy += p.ay * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        draw(p);
      }

      if (particles.length || emitters.length) requestAnimationFrame(frame);
      else running = false;
    }

    function draw(p) {
      const t = p.age / p.life;
      const fade = t < 0.15 ? t / 0.15 : 1 - Math.max(0, (t - 0.6) / 0.4);
      const size = p.size + p.grow * t;
      ctx.save();
      ctx.globalAlpha = Math.max(0, fade) * p.alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      if (p.kind === 'glyph') {
        ctx.fillStyle = p.color;
        ctx.font = `700 ${size}px "Segoe UI Symbol", "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,0.25)';
        ctx.shadowBlur = 3;
        ctx.fillText(p.glyph, 0, 0);
      } else if (p.kind === 'rect') {
        ctx.fillStyle = p.color;
        ctx.fillRect(-size / 2, -size / 4, size, size / 2);
      } else if (p.kind === 'circle') {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(0, 0, size, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'bubble') {
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.strokeStyle = 'rgba(80,120,200,0.6)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (p.kind === 'ring') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 3 * (1 - t) + 0.5;
        ctx.beginPath();
        ctx.ellipse(0, 0, size, size * 0.45, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    return { setState, setEnabled, burst: (name) => enabled && recipes[name] && recipes[name](getAnchor()) };
  }

  root.Particles = { create };
})(typeof self !== 'undefined' ? self : this);
