import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const DEFAULT_BACKEND =
  process.env.REACT_APP_BACKEND_URL ||
  (window.location.hostname === "localhost"
    ? "http://localhost:4000"
    : `http://${window.location.hostname}:4000`);

const socket = io(DEFAULT_BACKEND, { transports: ["websocket"] });

function useTimeOffset() {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    let mounted = true;
    const samples = [];
    const rounds = 5;
    const run = async () => {
      for (let i = 0; i < rounds; i++) {
        const t0 = Date.now();
        const serverNow = await new Promise((resolve) => { socket.emit("timeSync:now", null, resolve); });
        const t1 = Date.now();
        const latency = (t1 - t0) / 2;
        const thisOffset = serverNow - (t0 + latency);
        samples.push(thisOffset);
        await new Promise(r => setTimeout(r, 80));
      }
      if (!mounted) return;
      samples.sort((a, b) => a - b);
      const mid = Math.floor(samples.length / 2);
      setOffset(samples[mid]);
    };
    run();
    return () => { mounted = false; };
  }, []);
  return offset;
}

function App() {
  const [roleAssigned, setRoleAssigned] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [sessionCode, setSessionCode] = useState("");
  const [inputSessionCode, setInputSessionCode] = useState("");
  const [name, setName] = useState("");
  const [players, setPlayers] = useState([]);
  const [buzzList, setBuzzList] = useState([]);
  const [history, setHistory] = useState([]);
  const [countdownMs, setCountdownMs] = useState(0);
  const [running, setRunning] = useState(false);
  const [sessionClosed, setSessionClosed] = useState(false);
  const [serverStartTime, setServerStartTime] = useState(null);

  const offset = useTimeOffset();
  const countdownTimer = useRef(null);

  useEffect(() => {
    const saved = localStorage.getItem("buzzerSession");
    if (saved) {
      try { socket.emit("reconnectSession", JSON.parse(saved)); } catch { }
    }
  }, []);

  useEffect(() => {
    function onSessionCreated({ sessionCode, role, state }) {
      setSessionCode(sessionCode);
      setIsAdmin(role === "admin");
      setRoleAssigned(true);
      setPlayers(state.players || []);
      setHistory(state.history || []);
      setRunning(!!(state.timer && state.timer.running));
      setServerStartTime(state.timer?.serverStartTime || null);
      setSessionClosed(!!state.closed);
      // persist for refresh
      localStorage.setItem("buzzerSession", JSON.stringify({ role: role === "admin" ? "admin" : "player", code: sessionCode, name }));
    }
    function onJoinedSession({ sessionCode, role, state }) {
      setSessionCode(sessionCode);
      setIsAdmin(role === "admin");
      setRoleAssigned(true);
      setRunning(!!(state.timer && state.timer.running));
      setServerStartTime(state.timer?.serverStartTime || null);
      setSessionClosed(!!state.closed);
      localStorage.setItem("buzzerSession", JSON.stringify({ role: role === "admin" ? "admin" : "player", code: sessionCode, name }));
    }
    function onPlayerList(list) { setPlayers(list || []); }
    function onBuzzList(list) { setBuzzList(list || []); }
    function onHistory(data) { setHistory(data || []); }
    function onTimerStarted({ serverStartTime }) {
      setRunning(true);
      setServerStartTime(serverStartTime);
      const now = Date.now();
      const delay = serverStartTime - now - 5;
      if (delay <= 0) { setCountdownMs(0); return; }
      setCountdownMs(delay);
      if (countdownTimer.current) clearInterval(countdownTimer.current);
      countdownTimer.current = setInterval(() => {
        setCountdownMs(prev => {
          const nxt = Math.max(0, prev - 100);
          if (nxt === 0) clearInterval(countdownTimer.current);
          return nxt;
        });
      }, 100);
    }
    function onTimerReset() { setRunning(false); setBuzzList([]); setCountdownMs(0); setServerStartTime(null); }
    function onSessionClosed() { setSessionClosed(true); setRunning(false); setBuzzList([]); setPlayers([]); setCountdownMs(0); setServerStartTime(null); localStorage.removeItem("buzzerSession"); }

    socket.on("sessionCreated", onSessionCreated);
    socket.on("joinedSession", onJoinedSession);
    socket.on("playerList", onPlayerList);
    socket.on("buzzList", onBuzzList);
    socket.on("historyData", onHistory);
    socket.on("timerStarted", onTimerStarted);
    socket.on("timerReset", onTimerReset);
    socket.on("sessionClosed", onSessionClosed);
    socket.on("errorMsg", m => alert(m));

    return () => {
      socket.off("sessionCreated", onSessionCreated);
      socket.off("joinedSession", onJoinedSession);
      socket.off("playerList", onPlayerList);
      socket.off("buzzList", onBuzzList);
      socket.off("historyData", onHistory);
      socket.off("timerStarted", onTimerStarted);
      socket.off("timerReset", onTimerReset);
      socket.off("sessionClosed", onSessionClosed);
    };
  }, [name]);

  // persist whenever roleAssigned changes
  useEffect(() => {
    if (!roleAssigned) return;
    const snap = { role: isAdmin ? "admin" : "player", code: sessionCode, name };
    localStorage.setItem("buzzerSession", JSON.stringify(snap));
  }, [roleAssigned, isAdmin, sessionCode, name]);

  const createSession = () => {
    const code = Math.random().toString(36).substring(2, 7).toUpperCase();
    socket.emit("createSession", { sessionCode: code });
  };
  const joinSession = () => {
    const code = inputSessionCode.trim().toUpperCase();
    if (!code || !name.trim()) { alert("Enter session code and name"); return; }
    socket.emit("joinSession", { sessionCode: code, name: name.trim() });
  };
  const startTimer = () => socket.emit("startTimer", { sessionCode, delayMs: 1200 });
  const resetTimer = () => socket.emit("resetTimer", { sessionCode });
  const closeSession = () => {
    if (!window.confirm("Close session for all players?")) return;
    socket.emit("closeSession", { sessionCode });
    // keep admin on home after closing
    localStorage.removeItem("buzzerSession");
    setRoleAssigned(false);
    setIsAdmin(false);
    setSessionCode("");
  };
  const pressBuzzer = () => socket.emit("pressBuzzer", { sessionCode, clientTime: Date.now(), clientToServerOffset: offset });
  const saveWinner = () => socket.emit("saveWinner", { sessionCode });
  const fetchHistory = () => socket.emit("getHistory", { sessionCode });

  if (sessionClosed) {
    return <Shell><Card><Title>Session closed</Title><p className="muted">The admin ended this session.</p><div style={{ marginTop: 12 }}><Button onClick={() => { setRoleAssigned(false); setSessionClosed(false); localStorage.removeItem("buzzerSession"); window.location.reload(); }}>Back to Home</Button></div></Card></Shell>;
  }

  if (!roleAssigned) {
    return (
      <Shell>
        <Header />
        <Card>
          <Title>Buzzer Pro</Title>
          <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
            <Button variant="primary" onClick={createSession}>Create Session (Admin)</Button>
            <Divider />
            <Input placeholder="Session Code" value={inputSessionCode} onChange={setInputSessionCode} />
            <Input placeholder="Your Name" value={name} onChange={setName} />
            <Button onClick={joinSession}>Join as Player</Button>
          </div>
        </Card>
        <Footer />
      </Shell>
    );
  }

  if (isAdmin) {
    return (
      <Shell>
        <Header />
        <Card>
          <Title>Admin Panel</Title>
          <Badge>Session: {sessionCode}</Badge>
          <section className="row">
            <div className="col">
              <SubTitle>Controls</SubTitle>
              <div className="grid">
                <Button variant="primary" onClick={startTimer}>Start Timer</Button>
                <Button onClick={resetTimer}>Reset Timer</Button>
                <Button variant="danger" onClick={closeSession}>Close Session</Button>
                <Button onClick={saveWinner}>Save Winner</Button>
                <Button onClick={fetchHistory}>Refresh History</Button>
              </div>
              <div style={{ marginTop: 12 }}>{running ? <Tag color="#22c55e">Running</Tag> : <Tag color="#f97316">Idle</Tag>}{countdownMs > 0 && <Tag color="#38bdf8">Starts in {Math.ceil(countdownMs / 1000)}s</Tag>}</div>
            </div>
            <div className="col">
              <SubTitle>Players</SubTitle>
              <List items={players.map(p => p.name)} emptyText="No players yet" />
            </div>
          </section>
          <section style={{ marginTop: 16 }}>
            <SubTitle>Buzz Order</SubTitle>
            <OrderedList items={buzzList.map(b => { if (!serverStartTime) return b.name; const reaction = ((b.pressedAt - serverStartTime) / 1000).toFixed(3); return `${b.name} (${reaction}s)`; })} emptyText="No buzzes yet" />
          </section>
          <section style={{ marginTop: 16 }}>
            <SubTitle>History</SubTitle>
            <OrderedList items={history.map(h => `${new Date(h.at).toLocaleTimeString()} — ${h.winner}`)} emptyText="No history yet" />
          </section>
        </Card>
        <Footer />
      </Shell>
    );
  }

  return (
    <Shell>
      <Header />
      <Card>
        <Title>Player</Title>
        <Badge>Session: {sessionCode}</Badge>
        <div style={{ marginTop: 12 }}>
          {running ? (countdownMs > 0 ? <p className="muted">Get ready… starts in {Math.ceil(countdownMs / 1000)}s</p> : <BigButton onClick={pressBuzzer}>BUZZ!</BigButton>) : <p className="muted">Wait for the admin to start the timer…</p>}
        </div>
      </Card>
      <Footer />
    </Shell>
  );
}

// UI primitives
function Shell({ children }) { return <div style={{ width: "100%", maxWidth: 780, margin: "0 auto", padding: 12 }}>{children}</div>; }
function Header() { return <div style={{ padding: "8px 0 16px", display: "flex", justifyContent: "center" }}><h1 style={{ margin: 0, fontSize: 18, color: "#7dd3fc" }}>Buzzer Pro</h1></div>; }
function Footer() { return <div style={{ padding: 16, opacity: 0.8, textAlign: "center", fontSize: 12 }}><span> Made for local LAN by Kenstudios 🎉</span></div>; }
function Card({ children }) { return <div style={{ background: "#0b1220", border: "1px solid #1f2a44", borderRadius: 16, padding: 16, boxShadow: "0 10px 30px rgba(0,0,0,0.25)" }}>{children}</div>; }
function Title({ children }) { return <h2 style={{ margin: 0, fontSize: 20 }}>{children}</h2>; }
function SubTitle({ children }) { return <h3 style={{ margin: "12px 0 8px", fontSize: 16, color: "#93c5fd" }}>{children}</h3>; }
function Divider() { return <div style={{ height: 1, background: "#1f2a44", margin: "8px 0" }} />; }
function Badge({ children }) { return <div style={{ display: "inline-block", background: "#111827", border: "1px solid #374151", padding: "6px 10px", borderRadius: 999, fontSize: 12, marginTop: 8 }}>{children}</div>; }
function Tag({ children, color }) { return <span style={{ display: "inline-block", background: color, color: "#0b1220", padding: "4px 8px", borderRadius: 999, fontSize: 12, marginRight: 6 }}>{children}</span>; }
function Button({ children, onClick, variant = "default" }) { const bg = variant === "primary" ? "#38bdf8" : variant === "danger" ? "#ef4444" : "#334155"; const fg = variant === "primary" || variant === "danger" ? "#0b1220" : "#e2e8f0"; return <button onClick={onClick} style={{ background: bg, color: fg, border: "none", borderRadius: 12, padding: "10px 14px", fontWeight: 600, cursor: "pointer", width: "100%" }}>{children}</button>; }
function BigButton({ children, onClick }) { return <button onClick={onClick} style={{ background: "#22c55e", color: "#0b1220", border: "none", borderRadius: 24, padding: "20px 24px", fontWeight: 900, fontSize: 28, cursor: "pointer", width: "100%" }}>{children}</button>; }
function Input({ placeholder, value, onChange }) { return <input placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: "1px solid #1f2a44", background: "#0b1220", color: "#e2e8f0", outline: "none" }} />; }
function List({ items, emptyText }) { if (!items || items.length === 0) return <p className="muted">{emptyText}</p>; return <ul style={{ margin: 0, paddingLeft: 18 }}>{items.map((it, i) => <li key={i}>{it}</li>)}</ul>; }
function OrderedList({ items, emptyText }) { if (!items || items.length === 0) return <p className="muted">{emptyText}</p>; return <ol style={{ margin: 0, paddingLeft: 18 }}>{items.map((it, i) => <li key={i}>{it}</li>)}</ol>; }

export default App;
