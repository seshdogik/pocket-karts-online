// =============================================================================
// Pocket Karts Online - All-in-One File
// Autor: AI asistent
// Popis: Tento soubor obsahuje kompletní Node.js server a herní kód (klienta)
// pro jednoduchou 2D multiplayerovou hru s motokárami.
// =============================================================================

// -----------------------------------------------------------------------------
// ČÁST 1: SERVEROVÁ LOGIKA (Backend - Node.js)
// -----------------------------------------------------------------------------

const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const players = {};

// Hlavní a jediná cesta - pošle hráči kompletní HTML stránku s hrou
app.get('/', (req, res) => {
  res.send(HTML_CONTENT);
});

// Logika pro správu hráčů a jejich pohybů
io.on('connection', (socket) => {
  console.log('Hráč se připojil:', socket.id);

  // Vytvoříme nového hráče a přidáme ho do seznamu
  players[socket.id] = {
    rotation: 0,
    x: Math.floor(Math.random() * 400) + 200, // Náhodná startovní pozice
    y: Math.floor(Math.random() * 300) + 150,
    playerId: socket.id,
    color: Math.random() * 0xffffff // Náhodná barva
  };

  // Pošleme seznam všech hráčů nově připojenému hráči
  socket.emit('currentPlayers', players);
  
  // Informujeme ostatní hráče, že se připojil nový hráč
  socket.broadcast.emit('newPlayer', players[socket.id]);

  // Když se hráč odpojí
  socket.on('disconnect', () => {
    console.log('Hráč se odpojil:', socket.id);
    delete players[socket.id]; // Odstraníme hráče ze seznamu
    io.emit('playerDisconnected', socket.id); // Informujeme ostatní
  });

  // Když server obdrží data o pohybu hráče
  socket.on('playerMovement', (movementData) => {
    if (players[socket.id]) {
      players[socket.id].x = movementData.x;
      players[socket.id].y = movementData.y;
      players[socket.id].rotation = movementData.rotation;
      // Rozešleme informaci o pohybu všem ostatním hráčům
      socket.broadcast.emit('playerMoved', players[socket.id]);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`================================================`);
  console.log(`  Pocket Karts Online server běží!`);
  console.log(`  Otevři prohlížeč na adrese: http://localhost:${PORT}`);
  console.log(`================================================`);
});


// -----------------------------------------------------------------------------
// ČÁST 2: HERNÍ STRÁNKA (Frontend - HTML, CSS, a JavaScript Klient)
// -----------------------------------------------------------------------------
// Tento velký textový blok je kompletní HTML stránka, kterou server pošle
// každému hráči, který se připojí.
// -----------------------------------------------------------------------------

const HTML_CONTENT = `
<!DOCTYPE html>
<html>
<head>
    <title>Pocket Karts Online</title>
    <style>
        body { margin: 0; background-color: #333; overflow: hidden; }
        canvas { display: block; margin: 0 auto; }
    </style>
</head>
<body>
    <!-- Knihovny se načítají z internetu (CDN) -->
    <script src="https://cdn.jsdelivr.net/npm/phaser@3.60.0/dist/phaser.min.js"></script>
    <script src="/socket.io/socket.io.js"></script>
    
    <!-- A tady začíná náš herní kód, který poběží v prohlížeči -->
    <script>
        class GameScene extends Phaser.Scene {
            constructor() {
                super({ key: 'GameScene' });
                this.player = null;
                this.otherPlayers = null;
                this.cursors = null;
            }

            preload() {
                // Načteme obrázky z internetu, abychom nepotřebovali lokální soubory
                this.load.image('kart', 'https://i.imgur.com/8QoW3g7.png');
                this.load.image('track', 'https://i.imgur.com/V6H3a5B.png');
            }

            create() {
                // Připojení k serveru
                this.socket = io();
                this.otherPlayers = this.physics.add.group();

                // Přidáme trať jako pozadí
                this.add.image(400, 300, 'track');

                // Nastavení ovládání
                this.cursors = this.input.keyboard.createCursorKeys();
                
                // --- Komunikace se serverem ---
                // Přijmeme seznam všech hráčů, kteří už ve hře jsou
                this.socket.on('currentPlayers', (players) => {
                    Object.keys(players).forEach((id) => {
                        if (players[id].playerId === this.socket.id) {
                            this.addPlayer(players[id]);
                        } else {
                            this.addOtherPlayers(players[id]);
                        }
                    });
                });

                // Přidáme nového hráče, který se právě připojil
                this.socket.on('newPlayer', (playerInfo) => {
                    this.addOtherPlayers(playerInfo);
                });

                // Odstraníme hráče, který se odpojil
                this.socket.on('playerDisconnected', (playerId) => {
                    this.otherPlayers.getChildren().forEach((otherPlayer) => {
                        if (playerId === otherPlayer.playerId) {
                            otherPlayer.destroy();
                        }
                    });
                });
                
                // Aktualizujeme pozici ostatních hráčů
                this.socket.on('playerMoved', (playerInfo) => {
                    this.otherPlayers.getChildren().forEach((otherPlayer) => {
                        if (playerInfo.playerId === otherPlayer.playerId) {
                            // Použijeme tween pro plynulejší pohyb
                            this.tweens.add({
                                targets: otherPlayer,
                                x: playerInfo.x,
                                y: playerInfo.y,
                                rotation: playerInfo.rotation,
                                duration: 50, // Krátká doba pro plynulý přechod
                                ease: 'Linear'
                            });
                        }
                    });
                });
            }

            update() {
                if (this.player) {
                    const speed = 200;

                    // Zatáčení
                    if (this.cursors.left.isDown) {
                        this.player.setAngularVelocity(-150);
                    } else if (this.cursors.right.isDown) {
                        this.player.setAngularVelocity(150);
                    } else {
                        this.player.setAngularVelocity(0);
                    }

                    // Pohyb dopředu a dozadu
                    if (this.cursors.up.isDown) {
                        this.physics.velocityFromRotation(this.player.rotation - Math.PI / 2, speed, this.player.body.velocity);
                    } else if (this.cursors.down.isDown) {
                        this.physics.velocityFromRotation(this.player.rotation - Math.PI / 2, -speed, this.player.body.velocity);
                    } else {
                        // Pokud nic nemačkáme, motokára se sama zastaví díky "drag"
                    }

                    // Odeslání pozice na server, pokud se změnila
                    const { x, y, rotation } = this.player;
                    if (this.player.oldPosition && (Math.abs(x - this.player.oldPosition.x) > 0.5 || Math.abs(y - this.player.oldPosition.y) > 0.5 || Math.abs(rotation - this.player.oldPosition.rotation) > 0.01)) {
                        this.socket.emit('playerMovement', { x, y, rotation });
                    }

                    this.player.oldPosition = { x, y, rotation };
                }
            }

            // Funkce pro vytvoření naší motokáry
            addPlayer(playerInfo) {
                this.player = this.physics.add.image(playerInfo.x, playerInfo.y, 'kart').setOrigin(0.5, 0.5).setDisplaySize(50, 40);
                this.player.setTint(playerInfo.color);
                this.player.setDrag(100);
                this.player.setAngularDrag(100);
                this.player.setMaxVelocity(300);
                this.player.setCollideWorldBounds(true);
            }

            // Funkce pro vytvoření motokár ostatních hráčů
            addOtherPlayers(playerInfo) {
                const otherPlayer = this.add.sprite(playerInfo.x, playerInfo.y, 'kart').setOrigin(0.5, 0.5).setDisplaySize(50, 40);
                otherPlayer.setTint(playerInfo.color);
                otherPlayer.playerId = playerInfo.playerId;
                this.otherPlayers.add(otherPlayer);
            }
        }

        const config = {
            type: Phaser.AUTO,
            width: 800,
            height: 600,
            physics: {
                default: 'arcade',
                arcade: {
                    debug: false,
                    gravity: { y: 0 }
                }
            },
            scene: GameScene
        };

        const game = new Phaser.Game(config);
    </script>
</body>
</html>
`;