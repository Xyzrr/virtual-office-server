import express from "express";
import path from "path";

import { Room, Client, Server } from "colyseus";
import { Schema, type, MapSchema } from "@colyseus/schema";
import { createServer } from "http";

const PORT = process.env.PORT || 5000;

export class Player extends Schema {
  @type("number")
  x = Math.floor(Math.random() * 400);

  @type("number")
  y = Math.floor(Math.random() * 400);

  @type("number")
  dir = 0;

  @type("number")
  speed = 0;
}

export class State extends Schema {
  @type({ map: Player })
  players = new MapSchema<Player>();

  createPlayer(sessionId: string) {
    this.players.set(sessionId, new Player());
  }

  removePlayer(sessionId: string) {
    this.players.delete(sessionId);
  }

  setPlayerMovement(sessionId: string, dir: number, speed: number) {
    const player = this.players.get(sessionId);
    player.dir = dir;
    player.speed = speed;
  }

  update(delta: number) {
    this.players.forEach((player) => {
      player.x += player.speed * Math.cos(player.dir) * delta;
      player.y -= player.speed * Math.sin(player.dir) * delta;
    });
  }
}

export class MainRoom extends Room<State> {
  maxClients = 4;

  onCreate(options: any) {
    console.log("room created", options);

    this.setState(new State());

    this.onMessage("setMovement", (client, data) => {
      console.log("received message from ", client.sessionId, ":", data);
      this.state.setPlayerMovement(client.sessionId, data.dir, data.speed);
    });

    let lastFrameTime = Date.now();
    setInterval(() => {
      const now = Date.now();
      const delta = now - lastFrameTime;
      lastFrameTime = now;

      this.state.update(delta);
    }, 17);
  }

  onAuth(client: any, options: any, req: any) {
    return true;
  }

  onJoin(client: Client) {
    this.state.createPlayer(client.sessionId);
  }

  onLeave(client: Client) {
    this.state.removePlayer(client.sessionId);
  }

  onDispose() {
    console.log("dispose");
  }
}

const app = express();
app.use(express.json());

const gameServer = new Server({
  server: createServer(app),
});

gameServer.define("main", MainRoom).enableRealtimeListing();

gameServer.listen(Number(process.env.PORT) || 3000);
