// =============================================================================
// Pocket Karts Online - FUNKČNÍ VERZE
// Tento soubor obsahuje server i klienta s kompletní herní logikou.
// =============================================================================

// -----------------------------------------------------------------------------
// ČÁST 1: SERVEROVÁ LOGIKA (Backend)
// -----------------------------------------------------------------------------
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const GAME_WIDTH = 800;
const GAME_HEIGHT = 600;
const KART_SPEED = 2.5;
const KART_TURN_SPEED = 0.05;
const LAPS_TO_WIN = 5;

// Herní stav - jediný zdroj pravdy
let gameState = createInitialGameState();

// Definice tratě a checkpointů
const track = {
    // Vnější ovál
    outerBounds: [ {x: 100, y: 100}, {x: 700, y: 100}, {x: 700, y: 500}, {x: 100, y: 500} ],
    // Vnitřní ovál
    innerBounds: [ {x: 250, y: 250}, {x: 550, y: 250}, {x: 550, y: 350}, {x: 250, y: 350} ],
    // Cílová čára (zóna 0)
    finishLine: { x: 400, y: 425, width: 10, height: 100 },
    // Checkpoint 1 (neviditelná zóna, kterou musí projet)
    checkpoint1: { x: 400, y: 125, width: 10, height: 100 }
};

function createInitialGameState() {
    return {
        status: 'waiting', // 'waiting', 'countdown', 'racing', 'finished'
        players: {},
        countdown: 5,
        winner: null
    };
}

// Hlavní herní smyčka serveru (60x za sekundu)
setInterval(() => {
    if (gameState.status === 'racing') {
        updatePlayers();
        io.emit('gameUpdate', getSafeGameState());
    }
}, 1000 / 60);

function updatePlayers() {
    Object.values(gameState.players).forEach(player => {
        // Zatáčení
        if (player.input.left) player.rotation -= KART_TURN_SPEED;
        if (player.input.right) player.rotation += KART_TURN_SPEED;
        
        // Pohyb vpřed
        if (player.input.up) {
            const newX = player.x + Math.cos(player.rotation) * KART_SPEED;
            const newY = player.y + Math.sin(player.rotation) * KART_SPEED;

            // Jednoduchá detekce kolizí s tratí
            if (isPositionValid(newX, newY)) {
                player.x = newX;
                player.y = newY;
            }
        }
        
        checkCheckpoints(player);
    });
}

function isPositionValid(x, y) {
    // Zjednodušená kontrola - je bod uvnitř vnějšího a vně vnitřního obdélníku?
    const inOuter = x > track.outerBounds[0].x && x < track.outerBounds[1].x && y > track.outerBounds[0].y && y < track.outerBounds[2].y;
    const inInner = x > track.innerBounds[0].x && x < track.innerBounds[1].x && y > track.innerBounds[0].y && y < track.innerBounds[2].y;
    return inOuter && !inInner;
}

function checkCheckpoints(player) {
    // Kontrola checkpointu 1
    if (player.lastCheckpoint === 0 && intersects(player, track.checkpoint1)) {
        player.lastCheckpoint = 1;
        console.log(`${player.id} prošel checkpointem 1`);
    }

    // Kontrola cílové čáry (zóna 0)
    if (player.lastCheckpoint === 1 && intersects(player, track.finishLine)) {
        player.lap++;
        player.lastCheckpoint = 0; // Reset pro další kolo
        console.log(`${player.id} dokončil kolo ${player.lap}`);
        
        if (player.lap > LAPS_TO_WIN && gameState.status === 'racing') {
            endGame(player);
        }
    }
}

function intersects(player, zone) {
    return player.x > zone.x - zone.width / 2 &&
           player.x < zone.x + zone.width / 2 &&
           player.y > zone.y - zone.height / 2 &&
           player.y < zone.y + zone.height / 2;
}

function getSafeGameState() {
    // Pošleme jen data potřebná pro vykreslení, ne citlivé věci
    const safePlayers = {};
    for (const [id, player] of Object.entries(gameState.players)) {
        safePlayers[id] = {
            x: player.x,
            y: player.y,
            rotation: player.rotation,
            color: player.color,
            lap: player.lap,
        };
    }
    
    // Seřadíme hráče podle kol a pozice (zjednodušeně)
    const sortedPlayerIds = Object.keys(safePlayers).sort((a, b) => {
        const playerA = gameState.players[a];
        const playerB = gameState.players[b];
        if (playerB.lap !== playerA.lap) return playerB.lap - playerA.lap;
        // Zde by byla složitější logika pro určení pozice v rámci kola... pro teď stačí
        return 0;
    });

    return {
        status: gameState.status,
        players: safePlayers,
        winner: gameState.winner,
        countdown: gameState.countdown,
        sortedPlayerIds: sortedPlayerIds
    };
}


function startGame() {
    gameState.status = 'countdown';
    gameState.countdown = 5;
    
    const countdownInterval = setInterval(() => {
        gameState.countdown--;
        io.emit('countdown', gameState.countdown);
        if (gameState.countdown <= 0) {
            clearInterval(countdownInterval);
            gameState.status = 'racing';
            io.emit('raceStart');
        }
    }, 1000);
}

function endGame(winner) {
    gameState.status = 'finished';
    gameState.winner = winner.id;
    io.emit('raceOver', { winnerId: winner.id, players: getSafeGameState().players });
    
    setTimeout(resetGame, 5000); // Po 5 sekundách reset
}

function resetGame() {
    console.log("Resetuji hru...");
    const oldPlayers = gameState.players;
    gameState = createInitialGameState();

    // Přesuneme hráče na start a resetujeme jim statistiky
    Object.keys(oldPlayers).forEach((id, index) => {
        gameState.players[id] = createPlayer(id, index, oldPlayers[id].color);
    });
    
    io.emit('gameReset', getSafeGameState());

    // Pokud je stále dost hráčů, spustíme novou hru
    if (Object.keys(gameState.players).length >= 2) {
        startGame();
    }
}

function createPlayer(id, index, color) {
    return {
        id: id,
        x: 350 + (index * 50),
        y: 470,
        rotation: -Math.PI / 2, // Směrem nahoru
        color: color || Math.random() * 0xffffff,
        lap: 1,
        lastCheckpoint: 0,
        input: { up: false, left: false, right: false }
    };
}

io.on('connection', (socket) => {
    console.log('Hráč se připojil:', socket.id);
    const playerCount = Object.keys(gameState.players).length;
    gameState.players[socket.id] = createPlayer(socket.id, playerCount);

    socket.emit('currentGameState', getSafeGameState());
    socket.broadcast.emit('playerJoined', gameState.players[socket.id]);

    if (Object.keys(gameState.players).length >= 2 && gameState.status === 'waiting') {
        startGame();
    }
    
    socket.on('playerInput', (input) => {
        if (gameState.players[socket.id] && gameState.status === 'racing') {
            gameState.players[socket.id].input = input;
        }
    });
    
    socket.on('disconnect', () => {
        console.log('Hráč se odpojil:', socket.id);
        delete gameState.players[socket.id];
        io.emit('playerLeft', socket.id);

        if (Object.keys(gameState.players).length < 2 && gameState.status === 'racing') {
            console.log("Nedostatek hráčů, resetuji hru.");
            resetGame();
        }
    });
});

app.get('/', (req, res) => {
  res.send(HTML_CONTENT);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server běží na http://localhost:${PORT}`);
});


// -----------------------------------------------------------------------------
// ČÁST 2: HERNÍ STRÁNKA (Frontend - HTML & Phaser)
// -----------------------------------------------------------------------------
const HTML_CONTENT = `
<!DOCTYPE html>
<html>
<head>
    <title>Pocket Karts Online - Funkční!</title>
    <style>
        body { margin: 0; background-color: #333; color: white; font-family: sans-serif; }
        canvas { display: block; margin: 0 auto; }
    </style>
</head>
<body>
    <script src="https://cdn.jsdelivr.net/npm/phaser@3.60.0/dist/phaser.min.js"></script>
    <script src="/socket.io/socket.io.js"></script>
    <script>
        class GameScene extends Phaser.Scene {
            constructor() {
                super({ key: 'GameScene' });
                this.karts = {};
                this.hudText = null;
                this.statusText = null;
            }

            preload() {
                this.load.image('kart', 'https://i.imgur.com/8QoW3g7.png');
            }

            create() {
                this.drawTrack();
                this.cursors = this.input.keyboard.createCursorKeys();
                this.socket = io();
                
                // Text pro HUD
                this.hudText = this.add.text(10, 10, 'Čekání na hráče...', { fontSize: '16px', fill: '#fff' });
                this.statusText = this.add.text(400, 300, 'Čekání na hru', { fontSize: '48px', fill: '#fff' }).setOrigin(0.5);

                // --- Komunikace se serverem ---
                this.socket.on('currentGameState', (state) => this.updateGameState(state));
                this.socket.on('gameUpdate', (state) => this.updateGameState(state));
                
                this.socket.on('playerJoined', (player) => this.addKart(player.id, player));
                this.socket.on('playerLeft', (playerId) => this.removeKart(playerId));

                this.socket.on('countdown', (count) => {
                    this.statusText.setText(count > 0 ? count : 'GO!');
                    this.statusText.setVisible(true);
                });

                this.socket.on('raceStart', () => {
                    this.statusText.setVisible(false);
                });

                this.socket.on('raceOver', (data) => {
                    const winnerName = 'Hráč ' + data.winnerId.substring(0, 4);
                    this.statusText.setText('Vítěz: ' + winnerName + '!');
                    this.statusText.setVisible(true);
                });
                
                this.socket.on('gameReset', (state) => {
                    this.statusText.setText('Čekání na novou hru...');
                    this.statusText.setVisible(true);
                    this.updateGameState(state);
                });
            }
            
            update() {
                // Posíláme serveru, jaké klávesy mačkáme
                const input = {
                    left: this.cursors.left.isDown,
                    right: this.cursors.right.isDown,
                    up: this.cursors.up.isDown
                };
                this.socket.emit('playerInput', input);
            }

            updateGameState(state) {
                // Aktualizace HUD
                this.updateHud(state);

                // Aktualizace všech motokár
                for (const id in state.players) {
                    if (this.karts[id]) {
                        // Aktualizujeme existující
                        this.karts[id].setPosition(state.players[id].x, state.players[id].y);
                        this.karts[id].setRotation(state.players[id].rotation);
                    } else {
                        // Vytvoříme novou, pokud chybí
                        this.addKart(id, state.players[id]);
                    }
                }
                 // Odstranění motokár, které už ve hře nejsou
                for (const id in this.karts) {
                    if (!state.players[id]) {
                       this.removeKart(id);
                    }
                }
            }

            updateHud(state) {
                let hudContent = 'Závod na 5 kol\\n\\n';
                if (state.sortedPlayerIds && state.players) {
                    state.sortedPlayerIds.forEach((id, index) => {
                        const player = state.players[id];
                        if (player) {
                            const isSelf = id === this.socket.id ? ' (TY)' : '';
                            hudContent += \`\${index + 1}. Hráč \${id.substring(0, 4)}\${isSelf} - Kolo: \${player.lap}/${LAPS_TO_WIN}\\n\`;
                        }
                    });
                }
                this.hudText.setText(hudContent);

                if(state.status === 'waiting') this.statusText.setText('Čekání na hráče...').setVisible(true);
            }

            addKart(id, player) {
                const kart = this.add.sprite(player.x, player.y, 'kart').setDisplaySize(40, 30);
                kart.setTint(player.color);
                this.karts[id] = kart;
            }

            removeKart(id) {
                if (this.karts[id]) {
                    this.karts[id].destroy();
                    delete this.karts[id];
                }
            }

            drawTrack() {
                const graphics = this.add.graphics();
                // Tráva
                graphics.fillStyle(0x3A9944, 1);
                graphics.fillRect(0, 0, 800, 600);
                // Trať
                graphics.fillStyle(0x959595, 1);
                graphics.fillRect(100, 100, 600, 400);
                graphics.fillEllipse(100, 300, 200, 400);
                graphics.fillEllipse(700, 300, 200, 400);
                // Vnitřek
                graphics.fillStyle(0x3A9944, 1);
                graphics.fillRect(250, 250, 300, 100);
                graphics.fillEllipse(250, 300, 100, 100);
                graphics.fillEllipse(550, 300, 100, 100);
                // Cílová čára
                graphics.fillStyle(0xffffff, 1);
                for(let i = 0; i < 5; i++) {
                    graphics.fillRect(395, 425 + (i * 20), 5, 10);
                    graphics.fillRect(400, 435 + (i * 20), 5, 10);
                }
            }
        }

        const config = {
            type: Phaser.AUTO,
            width: 800,
            height: 600,
            scene: GameScene
        };
        const game = new Phaser.Game(config);
    </script>
</body>
</html>
`;