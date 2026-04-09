// --- AUDIO CONFIGURATION ---
// Replace these URLs with your custom sound links
const AUDIO_SOURCES = {
    bgm: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3", // Background Music
    coin: "https://assets.mixkit.co/active_storage/sfx/2000/2000-preview.mp3",
    dash: "./Assets/dash.wav",
    hit: "./Assets/hit.wav",
    boss: "https://assets.mixkit.co/active_storage/sfx/951/951-preview.mp3",
    over: "https://assets.mixkit.co/active_storage/sfx/2020/2020-preview.mp3"
};

// --- AUDIO ENGINE ---
let audioCtx = null;
let bgmAudio = new Audio(AUDIO_SOURCES.bgm);
bgmAudio.loop = true;
bgmAudio.volume = 0.4;

// Preload SFX to prevent lag
const SFX_PLAYERS = {};
Object.keys(AUDIO_SOURCES).forEach(key => {
    if(key !== 'bgm') {
        SFX_PLAYERS[key] = new Audio(AUDIO_SOURCES[key]);
        SFX_PLAYERS[key].volume = 0.6;
    }
});

function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    document.getElementById('start-overlay').style.display = 'none';
    bgmAudio.play().catch(e => console.log("BGM pending user interaction"));
}

function playCustomSound(key) {
    if (!SFX_PLAYERS[key]) return;
    // Clone and play to allow overlapping sounds
    const sound = SFX_PLAYERS[key].cloneNode();
    sound.play();
}

const SFX = {
    coin: () => playCustomSound('coin'),
    dash: () => playCustomSound('dash'),
    hit: () => playCustomSound('hit'),
    boss: () => playCustomSound('boss'),
    over: () => {
        bgmAudio.pause();
        playCustomSound('over');
    }
};

// --- GAME ENGINE ---
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const dashBar = document.getElementById("dash-bar");
const livesEl = document.getElementById("lives");
const waveEl = document.getElementById("wave-display");
const weatherEl = document.getElementById("weather-display");
const comboEl = document.getElementById("combo-display");
const waveAnnouncer = document.getElementById("wave-announcer");
const gameOverModal = document.getElementById("game-over-modal");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let score = 0;
let isGameOver = false;
let gameTime = 0;
let wave = 1;
let lastBossScore = 0;
let shake = 0;
let combo = 1;
let comboTimer = 0;

let weatherType = 'clear'; 
let weatherTimer = 0;
let rainParticles = [];
for(let i=0; i<50; i++) rainParticles.push({x: Math.random()*canvas.width, y: Math.random()*canvas.height, s: 10+Math.random()*10});

let player = {
    x: canvas.width / 2, y: canvas.height / 2,
    w: 25, h: 25, vx: 0, vy: 0,
    accel: 0.9, friction: 0.9,
    canDash: true, dashCooldown: 0,
    isDashing: false, dashTargetX: 0, dashTargetY: 0,
    trail: [], lives: 3, shield: 0, invuln: 0
};

let obstacles = [];
let coins = [];
let powerups = [];
let bossProjectiles = [];
let keys = {};
let joystick = { x: 0, y: 0, active: false };
let touchStart = null;
let lastTapTime = 0;

let boss = {
    active: false, x: canvas.width / 2, y: -200,
    w: 160, h: 70, hp: 100, maxHp: 100,
    targetX: canvas.width / 2, shootTimer: 0
};

function updateWeather() {
    weatherTimer++;
    if (weatherTimer > 600) {
        const types = ['clear', 'rain', 'storm'];
        weatherType = types[Math.floor(Math.random() * types.length)];
        weatherTimer = 0;
        weatherEl.innerText = weatherType.toUpperCase() + (weatherType === 'clear' ? ' SKY' : ' ACTIVE');
    }
    if (weatherType === 'rain') {
        ctx.strokeStyle = 'rgba(0, 255, 255, 0.2)';
        rainParticles.forEach(p => {
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y + p.s); ctx.stroke();
            p.y += p.s; if (p.y > canvas.height) { p.y = -20; p.x = Math.random() * canvas.width; }
        });
    }
}

class Obstacle {
    constructor() {
        let rand = Math.random();
        this.type = (rand > 0.9) ? 'speeder' : (rand > 0.7) ? 'chaser' : 'static';
        this.w = 30; this.h = 30;
        this.x = Math.random() * (canvas.width - 30);
        this.y = -50;
        this.speed = (3 + (wave * 0.5));
        this.color = (this.type === 'speeder') ? "#fff" : (this.type === 'chaser') ? "#fa0" : "#f05";
        if(this.type === 'speeder') { this.w = 12; this.h = 50; this.speed *= 2.1; }
    }
    update() {
        if(this.type === 'chaser') this.x += (player.x - this.x) * 0.015;
        this.y += this.speed;
    }
    draw() {
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x, this.y, this.w, this.h);
    }
}

function announce(txt) {
    waveAnnouncer.innerText = txt;
    waveAnnouncer.style.opacity = 1;
    setTimeout(() => waveAnnouncer.style.opacity = 0, 2000);
}

function handleHit() {
    if (player.invuln > 0) return;
    SFX.hit(); 
    shake = 10;
    player.lives--;
    player.invuln = 90;
    livesEl.innerText = "LIVES: " + "❤️".repeat(player.lives);
    if (player.lives <= 0) endGame();
}

function endGame() {
    if (isGameOver) return;
    isGameOver = true;
    SFX.over();
    document.getElementById("final-score").innerText = score;
    document.getElementById("final-wave").innerText = wave;
    gameOverModal.style.display = "block";
    setTimeout(() => gameOverModal.classList.add("show"), 10);
}

function startDash() {
    if (!player.canDash || isGameOver) return;
    SFX.dash();
    player.isDashing = true;
    player.canDash = false;
    player.dashCooldown = 60;
    let dx = 0, dy = 0;
    if (joystick.active) { dx = joystick.x * 250; dy = joystick.y * 250; }
    else {
        if(keys["ArrowLeft"] || keys["a"]) dx = -220;
        if(keys["ArrowRight"] || keys["d"]) dx = 220;
        if(keys["ArrowUp"] || keys["w"]) dy = -220;
        if(keys["ArrowDown"] || keys["s"]) dy = 220;
        if(dx === 0 && dy === 0) dy = -220;
    }
    player.dashTargetX = player.x + dx;
    player.dashTargetY = player.y + dy;
}

function update() {
    if (isGameOver) return;
    gameTime++;

    if (comboTimer > 0) comboTimer--; else combo = 1;
    comboEl.innerText = "x" + combo;

    wave = Math.floor(score / 1500) + 1;
    waveEl.innerText = "WAVE: " + wave;
    if (score >= lastBossScore + 3000 && !boss.active) {
        lastBossScore = score;
        boss.active = true;
        boss.hp = 100 + (wave * 30);
        boss.maxHp = boss.hp;
        boss.y = -100;
        shake = 15;
        SFX.boss(); 
        announce("BOSS INBOUND");
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0); 
    ctx.fillStyle = "rgba(5, 5, 15, 0.4)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (shake > 0) {
        ctx.translate((Math.random()-0.5)*shake, (Math.random()-0.5)*shake);
        shake *= 0.9;
    }

    updateWeather();

    if (player.isDashing) {
        player.x += (player.dashTargetX - player.x) * 0.35;
        player.y += (player.dashTargetY - player.y) * 0.35;
        player.trail.push({ x: player.x, y: player.y, alpha: 0.6 });
        if (Math.abs(player.dashTargetX - player.x) < 2) player.isDashing = false;
    } else {
        if (keys["ArrowLeft"] || keys["a"]) player.vx -= player.accel;
        if (keys["ArrowRight"] || keys["d"]) player.vx += player.accel;
        if (keys["ArrowUp"] || keys["w"]) player.vy -= player.accel;
        if (keys["ArrowDown"] || keys["s"]) player.vy += player.accel;
        player.vx *= player.friction; player.vy *= player.friction;
        player.x += player.vx; player.y += player.vy;
    }

    player.x = Math.max(0, Math.min(canvas.width - player.w, player.x));
    player.y = Math.max(0, Math.min(canvas.height - player.h, player.y));

    if (player.dashCooldown > 0) {
        player.dashCooldown--;
        dashBar.style.width = ((60 - player.dashCooldown) / 60 * 100) + "%";
        if (player.dashCooldown <= 0) player.canDash = true;
    }
    if (player.invuln > 0) player.invuln--;

    player.trail.forEach((t, i) => {
        ctx.strokeStyle = `rgba(0, 255, 255, ${t.alpha})`;
        ctx.strokeRect(t.x, t.y, player.w, player.h);
        t.alpha -= 0.05; if(t.alpha <= 0) player.trail.splice(i, 1);
    });

    if (player.invuln % 6 < 3) {
        ctx.fillStyle = "#0ff";
        ctx.fillRect(player.x, player.y, player.w, player.h);
    }

    if (boss.active) {
        boss.y += (80 - boss.y) * 0.05;
        boss.shootTimer++;
        if (boss.shootTimer > 50 - (wave*2)) {
            bossProjectiles.push({ x: boss.x + boss.w/2, y: boss.y + boss.h, vx: (Math.random()-0.5)*8, vy: 4 + (wave/2) });
            boss.shootTimer = 0;
        }
        ctx.fillStyle = "#f0f"; ctx.fillRect(boss.x, boss.y, boss.w, boss.h);
        if (player.isDashing && player.x < boss.x + boss.w && player.x + player.w > boss.x && player.y < boss.y + boss.h && player.y + player.h > boss.y) {
            boss.hp -= 2; shake = 3;
            if (boss.hp <= 0) { boss.active = false; score += 2000; announce("TARGET ELIMINATED"); bossProjectiles = []; }
        }
    }

    bossProjectiles.forEach((p, i) => {
        p.x += p.vx; p.y += p.vy;
        ctx.fillStyle = "#f0f"; ctx.fillRect(p.x, p.y, 8, 8);
        if (!player.isDashing && Math.hypot(player.x - p.x, player.y - p.y) < 20) { handleHit(); bossProjectiles.splice(i, 1); }
        if (p.y > canvas.height) bossProjectiles.splice(i, 1);
    });

    if (!boss.active && gameTime % Math.max(8, 35 - wave) === 0) obstacles.push(new Obstacle());
    obstacles.forEach((o, i) => {
        o.update(); o.draw();
        if (player.x < o.x + o.w && player.x + player.w > o.x && player.y < o.y + o.h && player.y + player.h > o.y) {
            if (player.isDashing) {
                obstacles.splice(i, 1); score += 100 * combo; shake = 5; 
                SFX.coin(); 
            } else { handleHit(); obstacles.splice(i, 1); }
        }
        if (o.y > canvas.height) obstacles.splice(i, 1);
    });

    if (gameTime % 100 === 0) coins.push({ x: Math.random() * canvas.width, y: -20, speed: 3 });
    coins.forEach((c, i) => {
        c.y += c.speed;
        let d = Math.hypot(player.x - c.x, player.y - c.y);
        ctx.fillStyle = "#ffd700"; ctx.beginPath(); ctx.arc(c.x, c.y, 7, 0, Math.PI*2); ctx.fill();
        if (d < 25) { 
            coins.splice(i, 1); 
            score += 50 * combo; 
            comboTimer = 180;
            if (combo < 5) combo++;
            SFX.coin(); 
        }
    });

    scoreEl.innerText = score;
    requestAnimationFrame(update);
}

// Event Listeners
window.addEventListener('mousedown', initAudio);
window.addEventListener('touchstart', (e) => {
    initAudio();
    const t = e.touches[0]; const now = Date.now();
    if (now - lastTapTime < 300) startDash();
    lastTapTime = now; joystick.active = true; touchStart = { x: t.clientX, y: t.clientY };
});

window.onkeydown = (e) => { keys[e.key] = true; if(e.code === "Space") startDash(); };
window.onkeyup = (e) => keys[e.key] = false;
window.onresize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };

update();