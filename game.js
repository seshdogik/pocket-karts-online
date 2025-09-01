// =============================================================================
// Pocket Karts Online - FINÁLNÍ OPRAVENÁ VERZE
// Autor: AI asistent
// Opravy: Funkční vykreslení tratě, opraveny kritické chyby v JS klienta.
// =============================================================================

// -----------------------------------------------------------------------------
// ČÁST 1: SERVEROVÁ LOGIKA (Backend) - Bez zásadních změn
// -----------------------------------------------------------------------------
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const Matter = require('matter-js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const LAPS_TO_WIN = 3;

const engine = Matter.Engine.create({ gravity: { x: 0, y: 0 } });
const runner = Matter.Runner.create();
Matter.Runner.run(runner, engine);

const checkpoints = [
    { zone: { x: 400, y: 150, width: 10, height: 110 } },
    { zone: { x: 675, y: 300, width: 110, height: 10 } },
    { zone: { x: 400, y: 450, width: 10, height: 110 } },
    { zone: { x: 125, y: 300, width: 110, height: 10 } }
];

let gameState = createInitialGameState();

function createInitialGameState() {
    Matter.World.clear(engine.world, false);
    setupTrack();
    return { status: 'waiting', players: {}, countdown: 5, winner: null };
}

function setupTrack() {
    const wallOptions = { isStatic: true, restitution: 0.6, friction: 0.05 };
    const walls = [
        Matter.Bodies.rectangle(400, 75, 650, 50, wallOptions), Matter.Bodies.rectangle(400, 525, 650, 50, wallOptions),
        Matter.Bodies.rectangle(400, 200, 400, 50, wallOptions), Matter.Bodies.rectangle(400, 400, 400, 50, wallOptions),
        Matter.Bodies.rectangle(50, 300, 50, 450, wallOptions), Matter.Bodies.rectangle(750, 300, 50, 450, wallOptions),
        Matter.Bodies.rectangle(200, 300, 50, 150, wallOptions), Matter.Bodies.rectangle(600, 300, 50, 150, wallOptions),
    ];
    Matter.World.add(engine.world, walls);
}

Matter.Events.on(engine, 'afterUpdate', () => {
    if (gameState.status === 'racing') {
        Object.values(gameState.players).forEach(player => {
            applyPlayerInput(player);
            checkPlayerCheckpoints(player);
        });
    }
});

setInterval(() => io.emit('gameUpdate', getRenderState()), 1000 / 30);

function applyPlayerInput(player) {
    const { body, input } = player;
    const speed = Matter.Vector.magnitude(body.velocity);
    const turnFactor = Math.max(0.2, 1 - (speed / 4));
    if (input.left) Matter.Body.setAngularVelocity(body, -0.07 * turnFactor);
    else if (input.right) Matter.Body.setAngularVelocity(body, 0.07 * turnFactor);
    else Matter.Body.setAngularVelocity(body, body.angularVelocity * 0.9);
    if (input.up) {
        const forward = Matter.Vector.rotate({x: 1, y: 0}, body.angle);
        Matter.Body.applyForce(body, body.position, Matter.Vector.mult(forward, 0.0015));
    }
}

function checkPlayerCheckpoints(player) {
    const nextCheckpointIndex = (player.lastCheckpointPassed + 1) % checkpoints.length;
    if (intersects(player.body.position, checkpoints[nextCheckpointIndex].zone)) {
        player.lastCheckpointPassed = nextCheckpointIndex;
        if (nextCheckpointIndex === checkpoints.length - 1) {
            player.lap++;
            if (player.lap > LAPS_TO_WIN && gameState.status === 'racing') endGame(player);
        }
    }
}

function intersects(pos, zone) {
    return (pos.x > zone.x - zone.width/2 && pos.x < zone.x + zone.width/2 &&
            pos.y > zone.y - zone.height/2 && pos.y < zone.y + zone.height/2);
}

function getRenderState() {
    const renderPlayers = {};
    for (const [id, player] of Object.entries(gameState.players)) {
        renderPlayers[id] = { id, x: player.body.position.x, y: player.body.position.y, angle: player.body.angle, name: player.name, lap: player.lap };
    }
    const sorted = Object.keys(gameState.players).sort((a, b) => {
        const pA = gameState.players[a], pB = gameState.players[b];
        if (pB.lap !== pA.lap) return pB.lap - pA.lap;
        return pB.lastCheckpointPassed - pA.lastCheckpointPassed;
    });
    return { status: gameState.status, players: renderPlayers, winner: gameState.winner, countdown: gameState.countdown, sortedPlayerIds: sorted, checkpoints };
}

function startGame() {
    Object.values(gameState.players).forEach((p, i) => {
        Matter.Body.setPosition(p.body, { x: 200 + ((i%2)*60), y: 470 - (Math.floor(i/2)*40) });
        Matter.Body.setVelocity(p.body, { x: 0, y: 0 }); Matter.Body.setAngle(p.body, -Math.PI/2);
        p.lap = 1; p.lastCheckpointPassed = checkpoints.length - 1;
    });
    gameState.status = 'countdown'; gameState.countdown = 5;
    const timer = setInterval(() => {
        gameState.countdown--;
        if (gameState.countdown <= 0) { clearInterval(timer); gameState.status = 'racing'; }
    }, 1000);
}

function endGame(winner) {
    gameState.status = 'finished'; gameState.winner = winner.name;
    setTimeout(resetGame, 5000);
}

function resetGame() {
    const oldPlayers = Object.values(gameState.players).map(p => ({ id: p.id, name: p.name }));
    gameState = createInitialGameState();
    oldPlayers.forEach(p => addPlayerToGame(p.id, p.name));
    if (Object.keys(gameState.players).length >= 2) startGame();
}

function addPlayerToGame(id, name) {
    const body = Matter.Bodies.rectangle(100, 470, 45, 25, { frictionAir: 0.05, restitution: 0.5, density: 0.01 });
    Matter.World.add(engine.world, body);
    gameState.players[id] = { id, name, body, lap: 1, lastCheckpointPassed: checkpoints.length-1, input: {} };
}

io.on('connection', (socket) => {
    socket.on('joinGame', (name) => {
        addPlayerToGame(socket.id, name.substring(0, 12) || "Player");
        socket.emit('gameJoined', getRenderState());
        if (Object.keys(gameState.players).length >= 2 && gameState.status === 'waiting') startGame();
        socket.on('playerInput', (input) => { if (gameState.players[socket.id]) gameState.players[socket.id].input = input; });
    });
    socket.on('disconnect', () => {
        const p = gameState.players[socket.id];
        if (p) { Matter.World.remove(engine.world, p.body); delete gameState.players[socket.id];
            if (Object.keys(gameState.players).length < 2 && (gameState.status === 'racing' || gameState.status === 'countdown')) resetGame();
        }
    });
});

app.get('/', (req, res) => res.send(HTML_CONTENT));
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server běží na http://localhost:${PORT}`));


// -----------------------------------------------------------------------------
// ČÁST 2: HERNÍ STRÁNKA (Frontend) - OPRAVENÁ
// -----------------------------------------------------------------------------
const HTML_CONTENT = `
<!DOCTYPE html>
<html>
<head>
    <title>Pocket Karts - Opraveno!</title>
    <style> body { margin: 0; background-color: #2c3e50; color: white; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; } canvas { display: block; } #login-container { text-align: center; } h1 { font-size: 48px; color: #ecf0f1; } input { font-size: 20px; padding: 10px; border-radius: 5px; border: none; text-align: center; } button { font-size: 20px; padding: 10px 20px; border-radius: 5px; border: none; background-color: #2ecc71; color: white; cursor: pointer; margin-top: 10px; } #game-container { display: none; } </style>
</head>
<body>
    <div id="login-container"> <h1>Pocket Karts</h1> <input type="text" id="nameInput" placeholder="Zadej své jméno" maxlength="12"><br> <button id="playButton">Hrát</button> </div>
    <div id="game-container"></div>
    <script src="https://cdn.jsdelivr.net/npm/phaser@3.60.0/dist/phaser.min.js"></script>
    <script src="/socket.io/socket.io.js"></script>
    <script>
        class GameScene extends Phaser.Scene {
            constructor() { super({ key: 'GameScene' }); this.karts = {}; this.labels = {}; }
            
            init(data) {
                // Přijmeme počáteční data, která pošle socket.io po úspěšném připojení
                this.initialState = data.initialState;
            }

            preload() { this.load.image('kart', '/car.png'); }

            create() {
                this.drawTrack();
                this.cursors = this.input.keyboard.createCursorKeys();
                this.socket = window.socket;
                this.hudText = this.add.text(10, 10, 'Připojování...', { fontSize: '18px', fill: '#fff', stroke: '#000', strokeThickness: 4 });
                this.statusText = this.add.text(400, 300, '', { fontSize: '64px', fill: '#fff', stroke: '#000', strokeThickness: 6 }).setOrigin(0.5);
                
                // Zpracujeme úvodní stav hry
                if (this.initialState) {
                    this.updateGameState(this.initialState);
                }

                // A pak nasloucháme dalším aktualizacím
                this.socket.on('gameUpdate', (state) => this.updateGameState(state));
            }
            update() {
                this.socket.emit('playerInput', { left: this.cursors.left.isDown, right: this.cursors.right.isDown, up: this.cursors.up.isDown });
            }
            updateGameState(state) {
                this.updateHud(state);
                if (state.status === 'countdown') this.statusText.setText(state.countdown > 0 ? state.countdown : 'GO!');
                else if (state.status === 'finished') this.statusText.setText(\`Vítěz: \${state.winner}!\`);
                else this.statusText.setText('');
                for (const id in state.players) {
                    const pData = state.players[id];
                    if (!this.karts[id]) this.addKart(pData);
                    this.karts[id].setPosition(pData.x, pData.y).setRotation(pData.angle);
                    this.labels[id].setPosition(pData.x, pData.y - 30);
                }
                for (const id in this.karts) { if (!state.players[id]) this.removeKart(id); }
            }
            updateHud(state) {
                let hud = \`Kola: ${LAPS_TO_WIN}\\n\\n\`;
                state.sortedPlayerIds.forEach((id, index) => {
                    const p = state.players[id];
                    if(p) hud += \`\${index + 1}. \${p.name} - Kolo: \${p.lap}/${LAPS_TO_WIN}\\n\`;
                });
                this.hudText.setText(hud);
            }
            addKart(p) {
                this.karts[p.id] = this.add.sprite(p.x, p.y, 'kart').setDisplaySize(45, 25);
                const style = { fontSize: '14px', fill: '#fff', stroke: '#000', strokeThickness: 3 };
                this.labels[p.id] = this.add.text(p.x, p.y - 30, p.name, style).setOrigin(0.5);
            }
            removeKart(id) {
                if (this.karts[id]) this.karts[id].destroy();
                if (this.labels[id]) this.labels[id].destroy();
                delete this.karts[id]; delete this.labels[id];
            }
            
            // OPRAVENÁ a FUNKČNÍ metoda pro vykreslení tratě
            drawTrack() {
                const g = this.add.graphics();
                // Zelená tráva
                g.fillStyle(0x32a852);
                g.fillRect(0, 0, 800, 600);
                
                // Hlavní tělo tratě (šedý asfalt)
                g.fillStyle(0x555555, 1);
                g.fillRoundedRect(100, 100, 600, 400, 50);

                // Vnitřní zelená plocha
                g.fillStyle(0x32a852);
                g.fillRoundedRect(225, 225, 350, 150, 25);
                
                // Cílová čára
                g.fillStyle(0xffffff, 0.8);
                const finishLineY = 425;
                for(let i = 0; i < 7; i++) {
                    if (i % 2 === 0) continue;
                    g.fillRect(75, finishLineY - (i * 12), 150, 12);
                }
            }
        }
        
        // OPRAVENÁ a FUNKČNÍ logika spuštění
        const loginContainer = document.getElementById('login-container'), gameContainer = document.getElementById('game-container'),
            playButton = document.getElementById('playButton'), nameInput = document.getElementById('nameInput');
        
        playButton.addEventListener('click', () => {
            if (nameInput.value.trim().length > 0) {
                loginContainer.style.display = 'none';
                gameContainer.style.display = 'block';

                const socket = io();
                window.socket = socket;

                socket.emit('joinGame', nameInput.value);

                // Klíčová oprava: Hru vytvoříme až poté, co server potvrdí připojení
                socket.on('gameJoined', (initialState) => {
                     const LAPS_TO_WIN = ${LAPS_TO_WIN};
                     const config = { type: Phaser.AUTO, width: 800, height: 600, parent: 'game-container', scene: GameScene };
                     const game = new Phaser.Game(config);
                     // Pošleme počáteční data do scény, aby se mohla správně inicializovat
                     game.scene.start('GameScene', { initialState });
                });
            }
        });
    </script>
</body>
</html>
`;