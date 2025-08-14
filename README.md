**Buzzer Pro**

Buzzer Pro is a LAN-based buzzer game system built with React (frontend) and Node.js + Socket.IO (backend). It allows an admin to create a game session, have multiple players join, start a timer, track buzzer presses, save winners, and close sessions.

**Features**

**Admin panel:**

Create game sessions

Start/Reset timer

**Track player list**

See buzz order in real-time

Save winners to history

Close session for all players

**Player panel:**

Join sessions using a session code

Buzz when the timer starts

Automatic session restore on refresh

Real-time synchronization via Socket.IO

Server-based timer ensures fairness

Session persistence with localStorage: Admin and players stay connected after page refresh until the session is explicitly closed.

**Tech Stack**
Frontend: React, Socket.IO Client

Backend: Node.js, Express, Socket.IO

Communication: WebSockets (Socket.IO)

Data: In-memory session management

**Installation**
**Backend**
Navigate to the backend folder:

cd backend
Install dependencies:

npm install
Start the backend server:

npm start
The server will run on http://0.0.0.0:4000.

**Frontend**
Navigate to the frontend folder:

cd frontend
Install dependencies:

npm install
Start the React app:

npm start
The frontend will run on http://localhost:3000 (or accessible via your LAN IP).

**Usage**
Admin:
Click Create Session to start a new game.
Copy the session code and share it with players.
Start the timer when ready.
Reset or save winners as needed.
Click Close Session to end the game for all players.

Player:

Enter the session code and your name.

Wait for the timer to start.

Press the buzzer when ready.

Your session persists if you accidentally refresh, until the admin closes the session.


Notes
Timer is server-based, ensuring fairness across devices.

Session persists across page refresh using localStorage.

Closing a session ends it for all connected clients and removes local session data.

Future Improvements
Persist history to database (e.g., MongoDB or SQLite)

Add buzzer sound or visual effect for first press

Add authentication for admins

Mobile-friendly responsive UI
