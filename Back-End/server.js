// backend/server.js
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => res.send("Buzzer backend is running"));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const sessions = {};

function generateCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function serializePlayers(players) {
  return Object.entries(players).map(([sid, p]) => ({ socketId: sid, name: p.name, pressedAt: p.pressedAt }));
}

function removePlayer(socketId) {
  for (const [code, s] of Object.entries(sessions)) {
    if (s.players[socketId]) {
      delete s.players[socketId];
      if (s.adminId) io.to(s.adminId).emit("playerList", serializePlayers(s.players));
      break;
    }
  }
}

io.on("connection", (socket) => {
  socket.data.role = null;
  socket.data.sessionCode = null;
  socket.data.name = null;

  socket.on("timeSync:now", (_, cb) => { if (typeof cb === "function") cb(Date.now()); });

  socket.on("createSession", ({ sessionCode }) => {
    const code = (sessionCode && String(sessionCode).trim().toUpperCase()) || generateCode();
    sessions[code] = { adminId: socket.id, players: {}, timer: { running: false, serverStartTime: null }, history: [], closed: false };
    socket.join(code);
    socket.data.role = "admin";
    socket.data.sessionCode = code;
    io.to(socket.id).emit("sessionCreated", { sessionCode: code, role: "admin", state: { players: [], timer: sessions[code].timer, history: [], closed: false } });
  });

  socket.on("joinSession", ({ sessionCode, name }) => {
    const code = (sessionCode || "").trim().toUpperCase();
    const s = sessions[code];
    if (!s || s.closed) { io.to(socket.id).emit("errorMsg", "Session not found or closed"); return; }
    s.players[socket.id] = { name: (name || "Player").trim() || "Player", pressedAt: null };
    socket.join(code);
    socket.data.role = "player";
    socket.data.sessionCode = code;
    socket.data.name = s.players[socket.id].name;
    io.to(s.adminId).emit("playerList", serializePlayers(s.players));
    io.to(socket.id).emit("joinedSession", { sessionCode: code, role: "player", state: { timer: s.timer, closed: false } });
  });

  socket.on("reconnectSession", ({ role, code, name }) => {
    const sessionCode = (code || "").trim().toUpperCase();
    const s = sessions[sessionCode];
    if (!s || s.closed) { io.to(socket.id).emit("sessionClosed"); return; }
    if (role === "admin") {
      s.adminId = socket.id;
      socket.join(sessionCode);
      socket.data.role = "admin";
      socket.data.sessionCode = sessionCode;
      io.to(socket.id).emit("sessionCreated", { sessionCode, role: "admin", state: { players: serializePlayers(s.players), timer: s.timer, history: s.history, closed: false } });
    } else {
      s.players[socket.id] = { name: (name || "Player").trim() || "Player", pressedAt: null };
      socket.join(sessionCode);
      socket.data.role = "player";
      socket.data.sessionCode = sessionCode;
      socket.data.name = s.players[socket.id].name;
      io.to(s.adminId).emit("playerList", serializePlayers(s.players));
      io.to(socket.id).emit("joinedSession", { sessionCode, role: "player", state: { timer: s.timer, closed: false } });
    }
  });

  socket.on("startTimer", ({ sessionCode, delayMs = 1200 }) => {
    const code = (sessionCode || "").trim().toUpperCase();
    const s = sessions[code];
    if (!s || s.adminId !== socket.id || s.closed) return;
    s.timer.running = true;
    s.timer.serverStartTime = Date.now() + Math.max(0, delayMs);
    Object.values(s.players).forEach(p => p.pressedAt = null);
    io.to(code).emit("timerStarted", { serverStartTime: s.timer.serverStartTime });
    io.to(s.adminId).emit("buzzList", []);
  });

  socket.on("pressBuzzer", ({ sessionCode, clientTime, clientToServerOffset }) => {
    const code = (sessionCode || "").trim().toUpperCase();
    const s = sessions[code];
    if (!s || s.closed) return;
    if (!s.timer.running || !s.timer.serverStartTime) return;
    const player = s.players[socket.id];
    if (!player || player.pressedAt !== null) return;
    const approxServerTime = (clientTime || Date.now()) + (clientToServerOffset || 0);
    if (approxServerTime < s.timer.serverStartTime) return;
    player.pressedAt = approxServerTime;
    const order = Object.values(s.players).filter(p => p.pressedAt !== null).sort((a,b)=>a.pressedAt-b.pressedAt).map(p => ({ name: p.name, pressedAt: p.pressedAt }));
    io.to(s.adminId).emit("buzzList", order);
  });

  socket.on("resetTimer", ({ sessionCode }) => {
    const code = (sessionCode || "").trim().toUpperCase();
    const s = sessions[code];
    if (!s || s.adminId !== socket.id || s.closed) return;
    s.timer.running = false;
    s.timer.serverStartTime = null;
    Object.values(s.players).forEach(p => p.pressedAt = null);
    io.to(code).emit("timerReset");
    io.to(s.adminId).emit("buzzList", []);
  });

  socket.on("saveWinner", ({ sessionCode }) => {
    const code = (sessionCode || "").trim().toUpperCase();
    const s = sessions[code];
    if (!s || s.adminId !== socket.id || s.closed) return;
    const order = Object.values(s.players).filter(p => p.pressedAt !== null).sort((a,b)=>a.pressedAt-b.pressedAt).map(p => ({ name: p.name, pressedAt: p.pressedAt }));
    if (order.length > 0) {
      s.history.push({ winner: order[0].name, at: Date.now(), order });
      io.to(s.adminId).emit("historyData", s.history);
    }
  });

  socket.on("getHistory", ({ sessionCode }) => {
    const code = (sessionCode || "").trim().toUpperCase();
    const s = sessions[code];
    if (!s) return;
    io.to(socket.id).emit("historyData", s.history || []);
  });

  // Close session (admin only)
  socket.on("closeSession", ({ sessionCode }) => {
    const code = (sessionCode || "").trim().toUpperCase();
    const s = sessions[code];
    if (!s || s.adminId !== socket.id) return;
    s.closed = true;
    io.to(code).emit("sessionClosed");
    delete sessions[code];
  });

  socket.on("disconnect", () => removePlayer(socket.id));
});

const PORT = process.env.PORT || 4000;
const HOST = "0.0.0.0";
server.listen(PORT, HOST, () => console.log(`Server running on http://${HOST}:${PORT}`));
