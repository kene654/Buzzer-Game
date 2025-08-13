const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

let sessions = {}; // { code: { adminId, players, history } }

io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    // Create session (Admin)
    socket.on("createSession", ({ sessionCode }) => {
        sessions[sessionCode] = {
            adminId: socket.id,
            players: {},
            history: []
        };
        socket.join(sessionCode);
        socket.data.role = "admin";
        socket.data.sessionCode = sessionCode;

        io.to(socket.id).emit("sessionCreated", { sessionCode, role: "admin" });
    });

    // Join session (Player)
    socket.on("joinSession", ({ sessionCode, name }) => {
        if (!sessions[sessionCode]) {
            io.to(socket.id).emit("error", "Session not found");
            return;
        }
        sessions[sessionCode].players[socket.id] = { name, pressedAt: null };
        socket.join(sessionCode);
        socket.data.role = "player";
        socket.data.sessionCode = sessionCode;

        io.to(sessions[sessionCode].adminId).emit("playerList", sessions[sessionCode].players);
        io.to(socket.id).emit("joinedSession", { sessionCode, role: "player" });
    });

    // Start timer
    socket.on("startTimer", ({ sessionCode }) => {
        io.to(sessionCode).emit("timerStarted", { startTime: Date.now() });
        Object.values(sessions[sessionCode].players).forEach(p => p.pressedAt = null);
    });

    // Press buzzer
    socket.on("pressBuzzer", ({ sessionCode, clientTime }) => {
        let player = sessions[sessionCode]?.players[socket.id];
        if (player && player.pressedAt === null) {
            player.pressedAt = clientTime;
            const sorted = Object.values(sessions[sessionCode].players)
                .filter(p => p.pressedAt !== null)
                .sort((a, b) => a.pressedAt - b.pressedAt);
            io.to(sessions[sessionCode].adminId).emit("buzzList", sorted);
        }
    });

    // Reset timer
    socket.on("resetTimer", ({ sessionCode }) => {
        Object.values(sessions[sessionCode].players).forEach(p => p.pressedAt = null);
        io.to(sessionCode).emit("timerReset");
    });

    // Save winner
    socket.on("saveWinner", ({ sessionCode }) => {
        let players = Object.values(sessions[sessionCode].players)
            .filter(p => p.pressedAt !== null)
            .sort((a, b) => a.pressedAt - b.pressedAt);
        if (players.length > 0) {
            sessions[sessionCode].history.push(players[0]);
        }
    });

    // Get history
    socket.on("getHistory", ({ sessionCode }) => {
        io.to(socket.id).emit("historyData", sessions[sessionCode]?.history || []);
    });

    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
        // Optional: remove player from list
    });
});

server.listen(4000, '0.0.0.0', () => {
    console.log("Server running on http://192.168.0.101:4000");
});
