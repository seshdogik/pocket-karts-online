// =============================================================================
// Pocket Karts Online - ROBUSTNÍ VERZE
// Autor: AI asistent
// Vylepšení: Neprůstřelný systém checkpointů, precizní mantinely,
//            okamžité zmizení odpojených hráčů.
// =============================================================================

// -----------------------------------------------------------------------------
// ČÁST 1: SERVEROVÁ LOGIKA (Backend)
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

// Nastavení fyzikálního enginu
const engine = Matter.Engine.create({ gravity: { x: 0, y: 0 } });
const runner = Matter.Runner.create();
Matter.Runner.run(runner, engine);

// Definice checkpointů a startovní čáry. POŘADÍ JE KLÍČOVÉ!
// Hráč musí projet checkpointem 0, pak 1, atd. Cílová čára je poslední.
const checkpoints = [
    { zone: { x: 400, y: 150, width: 10, height: 110 } }, // Checkpoint 1
    { zone: { x: 675, y: 300, width: 110, height: 10 } }, // Checkpoint 2
    { zone: { x: 400, y: 450, width: 10, height: 110 } }, // Checkpoint 3
    { zone: { x: 125, y: 300, width: 110, height: 10 } }  // Cílová čára
];

// Herní stav
let gameState = createInitialGameState();

function createInitialGameState() {
    Matter.World.clear(engine.world, false); // Vyčistí staré motokáry
    setupTrack(); // Postaví trať
    
    return {
        status: 'waiting', // 'waiting', 'countdown', 'racing', 'finished'
        players: {},
        countdown: 5,
        winner: null,
    };
}

function setupTrack() {
    // Definice bodů tvořících středovou osu mantinelů
    const innerPath = [
        { x: 175, y: 450 }, { x: 175, y: 150 },
        { x: 625, y: 150 }, { x: 625, y: 450 }
    ];
    const outerPath = [
        { x: 75, y: 500 }, { x: 75, y: 100 },
        { x: 725, y: 100 }, { x: 725, y: 500 }
    ];

    const wallOptions = { isStatic: true, restitution: 0.6, friction: 0.05 };
    const walls = [
        // Rovné stěny
        Matter.Bodies.rectangle(400, 75, 650, 50, wallOptions),  // horní vnější
        Matter.Bodies.rectangle(400, 525, 650, 50, wallOptions), // dolní vnější
        Matter.Bodies.rectangle(400, 200, 400, 50, wallOptions), // horní vnitřní
        Matter.Bodies.rectangle(400, 400, 400, 50, wallOptions), // dolní vnitřní
        // Zatacky
        Matter.Bodies.rectangle(50, 300, 50, 450, wallOptions),   // levá vnější
        Matter.Bodies.rectangle(750, 300, 50, 450, wallOptions),  // pravá vnější
        Matter.Bodies.rectangle(200, 300, 50, 150, wallOptions),  // levá vnitřní
        Matter.Bodies.rectangle(600, 300, 50, 150, wallOptions),  // pravá vnitřní
    ];
    Matter.World.add(engine.world, walls);
}


// Hlavní serverová smyčka
Matter.Events.on(engine, 'afterUpdate', () => {
    if (gameState.status === 'racing') {
        Object.values(gameState.players).forEach(player => {
            applyPlayerInput(player);
            checkPlayerCheckpoints(player);
        });
    }
    // Posíláme aktualizace v pravidelném intervalu, ne po každé fyzikální iteraci
});

setInterval(() => {
    io.emit('gameUpdate', getRenderState());
}, 1000 / 30);


function applyPlayerInput(player) {
    const { body, input } = player;
    const forward = Matter.Vector.rotate(Matter.Vector.create(1, 0), body.angle);
    
    // Zatáčení - menší kontrola při vyšší rychlosti pro arkádovější pocit
    const speed = Matter.Vector.magnitude(body.velocity);
    const turnFactor = Math.max(0.2, 1 - (speed / 4));
    if (input.left) Matter.Body.setAngularVelocity(body, -0.07 * turnFactor);
    else if (input.right) Matter.Body.setAngularVelocity(body, 0.07 * turnFactor);
    else Matter.Body.setAngularVelocity(body, body.angularVelocity * 0.9);

    // Akcelerace
    if (input.up) {
        Matter.Body.applyForce(body, body.position, Matter.Vector.mult(forward, 0.0015));
    }
}

function checkPlayerCheckpoints(player) {
    const nextCheckpointIndex = (player.lastCheckpointPassed + 1) % checkpoints.length;
    const nextCheckpoint = checkpoints[nextCheckpointIndex];

    if (intersects(player.body.position, nextCheckpoint.zone)) {
        player.lastCheckpointPassed = nextCheckpointIndex;
        
        // Cílová čára je poslední checkpoint v poli
        if (nextCheckpointIndex === checkpoints.length - 1) {
            player.lap++;
            console.log(`Hráč ${player.name} dokončil kolo ${player.lap}`);

            if (player.lap > LAPS_TO_WIN && gameState.status === 'racing') {
                endGame(player);
            }
        }
    }
}


function intersects(position, zone) {
    return (
        position.x > zone.x - zone.width / 2 &&
        position.x < zone.x + zone.width / 2 &&
        position.y > zone.y - zone.height / 2 &&
        position.y < zone.y + zone.height / 2
    );
}

function getRenderState() {
    const renderPlayers = {};
    for (const [id, player] of Object.entries(gameState.players)) {
        renderPlayers[id] = {
            id, x: player.body.position.x, y: player.body.position.y, angle: player.body.angle,
            name: player.name, color: player.color, lap: player.lap
        };
    }

    const sortedPlayerIds = Object.keys(gameState.players).sort((a, b) => {
        const pA = gameState.players[a]; const pB = gameState.players[b];
        if (pB.lap !== pA.lap) return pB.lap - pA.lap;
        return pB.lastCheckpointPassed - pA.lastCheckpointPassed;
    });

    return {
        status: gameState.status, players: renderPlayers, winner: gameState.winner,
        countdown: gameState.countdown, sortedPlayerIds, checkpoints
    };
}


function startGame() {
    Object.values(gameState.players).forEach((player, index) => {
        const startX = 200;
        const startY = 470;
        Matter.Body.setPosition(player.body, { x: startX + ((index % 2) * 60), y: startY - (Math.floor(index / 2) * 40) });
        Matter.Body.setVelocity(player.body, { x: 0, y: 0 });
        Matter.Body.setAngle(player.body, -Math.PI / 2); // Směrem nahoru
        player.lap = 1;
        player.lastCheckpointPassed = checkpoints.length - 1; // Musí nejprve projet checkpoint 0
    });
    
    gameState.status = 'countdown'; gameState.countdown = 5;
    const countdownInterval = setInterval(() => {
        gameState.countdown--;
        if (gameState.countdown <= 0) {
            clearInterval(countdownInterval);
            gameState.status = 'racing';
        }
    }, 1000);
}

function endGame(winner) {
    gameState.status = 'finished';
    gameState.winner = winner.name;
    setTimeout(resetGame, 5000);
}

function resetGame() {
    console.log("Resetuji hru...");
    const oldPlayersData = Object.values(gameState.players).map(p => ({ id: p.id, name: p.name, color: p.color }));
    
    gameState = createInitialGameState();
    
    oldPlayersData.forEach(p => addPlayerToGame(p.id, p.name, p.color));

    if (Object.keys(gameState.players).length >= 2) startGame();
}

function addPlayerToGame(id, name, color) {
    const playerCount = Object.keys(gameState.players).length;
    const body = Matter.Bodies.rectangle( 100 + (playerCount * 50), 470, 45, 25, { frictionAir: 0.05, restitution: 0.5, density: 0.01 });
    Matter.World.add(engine.world, body);
    gameState.players[id] = {
        id, name, body, color: color || Math.random() * 0xffffff,
        lap: 1, lastCheckpointPassed: checkpoints.length - 1, input: {}
    };
}


io.on('connection', (socket) => {
    socket.on('joinGame', (playerName) => {
        const safeName = playerName.substring(0, 12) || "Player";
        addPlayerToGame(socket.id, safeName);
        socket.emit('gameJoined', getRenderState()); // Pošleme úvodní stav hned
        if (Object.keys(gameState.players).length >= 2 && gameState.status === 'waiting') {
            startGame();
        }
        socket.on('playerInput', (input) => {
            if (gameState.players[socket.id]) {
                gameState.players[socket.id].input = input;
            }
        });
    });

    socket.on('disconnect', () => {
        const player = gameState.players[socket.id];
        if (player) {
            console.log('Hráč se odpojil:', player.name);
            Matter.World.remove(engine.world, player.body);
            delete gameState.players[socket.id];
            
            if (Object.keys(gameState.players).length < 2 && (gameState.status === 'racing' || gameState.status === 'countdown')) {
                resetGame();
            }
        }
    });
});


app.get('/', (req, res) => res.send(HTML_CONTENT));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server běží na http://localhost:${PORT}`));


// -----------------------------------------------------------------------------
// ČÁST 2: HERNÍ STRÁNKA (Frontend)
// -----------------------------------------------------------------------------
const HTML_CONTENT = `
<!DOCTYPE html>
<html>
<head>
    <title>Pocket Karts - Robustní</title>
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
            preload() { this.load.image('kart', '/car.png'); }
            create() {
                this.drawTrack();
                this.cursors = this.input.keyboard.createCursorKeys();
                this.socket = window.socket;
                this.hudText = this.add.text(10, 10, 'Připojování...', { fontSize: '18px', fill: '#fff', stroke: '#000', strokeThickness: 4 });
                this.statusText = this.add.text(400, 300, '', { fontSize: '64px', fill: '#fff', stroke: '#000', strokeThickness: 6 }).setOrigin(0.5);

                this.socket.on('gameUpdate', (state) => this.updateGameState(state));
            }
            update() {
                this.socket.emit('playerInput', { left: this.cursors.left.isDown, right: this.cursors.right.isDown, up: this.cursors.up.isDown });
            }
            updateGameState(state) {
                // Update textů a statusů
                this.updateHud(state);
                if (state.status === 'countdown') this.statusText.setText(state.countdown > 0 ? state.countdown : 'GO!');
                else if (state.status === 'finished') this.statusText.setText(\`Vítěz: \${state.winner}!\`);
                else this.statusText.setText('');

                // Synchronizace motokár
                for (const id in state.players) {
                    const playerData = state.players[id];
                    if (!this.karts[id]) this.addKart(playerData);
                    
                    const kart = this.karts[id];
                    const label = this.labels[id];
                    kart.setPosition(playerData.x, playerData.y);
                    kart.setRotation(playerData.angle);
                    label.setPosition(playerData.x, playerData.y - 30);
                }
                
                // Odstranění odpojených
                for (const id in this.karts) { if (!state.players[id]) this.removeKart(id); }
            }
            updateHud(state) {
                let hudContent = \`Kola: ${LAPS_TO_WIN}\\n\\n\`;
                state.sortedPlayerIds.forEach((id, index) => {
                    const p = state.players[id];
                    if(p) hudContent += \`\${index + 1}. \${p.name} - Kolo: \${p.lap}/${LAPS_TO_WIN}\\n\`;
                });
                this.hudText.setText(hudContent);
                // Vykreslení checkpointů pro debug/přehlednost jen před hrou
                if(this.checkpointDebugGraphics) this.checkpointDebugGraphics.clear();
                if(state.status === 'waiting' && state.checkpoints){
                  this.checkpointDebugGraphics = this.checkpointDebugGraphics || this.add.graphics();
                  state.checkpoints.forEach((cp, index) => {
                      this.checkpointDebugGraphics.fillStyle(0xffffff, 0.2);
                      this.checkpointDebugGraphics.fillRect(cp.zone.x-cp.zone.width/2, cp.zone.y-cp.zone.height/2, cp.zone.width, cp.zone.height);
                      this.add.text(cp.zone.x, cp.zone.y, \`CP \${index}\`, {fontSize:'10px'}).setOrigin(0.5);
                  });
                }
            }
            addKart(p) {
                this.karts[p.id] = this.add.sprite(p.x, p.y, 'kart').setDisplaySize(45, 25).setTint(p.color);
                this.labels[p.id] = this.add.text(p.x, p.y - 30, p.name, { fontSize: '14px', fill: '#fff', stroke: '#000', strokeThickness: 3}).setOrigin(0.5);
            }
            removeKart(id) {
                if (this.karts[id]) this.karts[id].destroy();
                if (this.labels[id]) this.labels[id].destroy();
                delete this.karts[id]; delete this.labels[id];
            }
            drawTrack() {
                const g = this.add.graphics(); g.fillStyle(0x32a852); g.fillRect(0,0,800,600);
                g.fillStyle(0xbbbbbb,1);
                g.slice(125, 300, 75, Phaser.Math.DegToRad(90), Phaser.Math.DegToRad(270)).setClosePath(false).fillPath();
                g.slice(675, 300, 75, Phaser.Math.DegToRad(270), Phaser.Math.DegToRad(90)).setClosePath(false).fillPath();
                g.fillRect(125, 225, 550, 150);
                g.fillStyle(0x32a852);
                g.slice(225, 300, 25, Phaser.Math.DegToRad(90), Phaser.Math.DegToRad(270)).setClosePath(false).fillPath();
                g.slice(575, 300, 25, Phaser.Math.DegToRad(270), Phaser.Math.DegToRad(90)).setClosePath(false).fillPath();
                g.fillRect(225, 275, 350, 50);
                // Cílová čára
                g.fillStyle(0xffffff);
                for(let i = 0; i < 9; i++) { g.fillRect(100, 425 + (i * -20), 5, 10); g.fillRect(105, 415 + (i * -20), 5, 10); }
            }
        }
        
        // --- Spuštění hry po zadání jména ---
        const loginContainer = document.getElementById('login-container'), gameContainer = document.getElementById('game-container'),
            playButton = document.getElementById('playButton'), nameInput = document.getElementById('nameInput');
        
        playButton.addEventListener('click', () => {
            if (nameInput.value.trim().length > 0) {
                loginContainer.style.display = 'none'; gameContainer.style.display = 'block';
                const socket = io(); window.socket = socket;
                socket.emit('joinGame', nameInput.value);
                socket.on('gameJoined', (initialState) => {
                     const LAPS_TO_WIN = ${LAPS_TO_WIN};
                     const config = { type: Phaser.AUTO, width: 800, height: 600, parent: 'game-container', scene: GameScene };
                     const game = new Phaser.Game(config);
                     // Ujistíme se, že první update proběhne hned
                     game.scene.getScene('GameScene').updateGameState(initialState);
                });
            }
        });
    </script>
</body>
</html>
`;