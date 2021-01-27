import express from "express";
import path from "path";

import { Room, Client, Server } from "colyseus";
import { Schema, type, MapSchema } from "@colyseus/schema";
import { createServer } from "http";
import twilio, { Twilio } from "twilio";
import { SubscribeRulesListInstanceUpdateOptions } from "twilio/lib/rest/video/v1/room/roomParticipant/roomParticipantSubscribeRule";

const PORT = process.env.PORT || 5000;

const ACCOUNT_SID = "AC38ede87c7601fb1e80347d0fb358965f";
const API_KEY_SID = "SKb1583de43dafe4f8076f477383342990";
const API_KEY_SECRET = "i4BcXHV8nAB1Vxn1kguNOsa5vpaMhK50";

const twilioClient = new Twilio(API_KEY_SID, API_KEY_SECRET, {
  accountSid: ACCOUNT_SID,
});

let lastRulesUpdateTime = 0;
let lastFrameTime = 0;

export class Player extends Schema {
  @type("string")
  identity = "";

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
    console.log("removing player", sessionId);
    this.players.delete(sessionId);
  }

  setPlayerMovement(sessionId: string, dir: number, speed: number) {
    const player = this.players.get(sessionId);
    player.dir = dir;
    player.speed = speed;
  }

  setPlayerIdentity(sessionId: string, identity: string) {
    const player = this.players.get(sessionId);
    player.identity = identity;
  }

  update(delta: number) {
    this.players.forEach((player) => {
      player.x += player.speed * Math.cos(player.dir) * delta;
      player.y -= player.speed * Math.sin(player.dir) * delta;

      if (lastFrameTime - lastRulesUpdateTime < 1) {
        return;
      }

      lastRulesUpdateTime = lastFrameTime;

      if (player.identity === "") {
        return;
      }

      const nearbyPlayers: Player[] = [];
      this.players.forEach((p) => {
        if (p === player || p.identity === "") {
          return;
        }

        const dx = p.x - player.x;
        const dy = p.y - player.y;

        const distanceSquared = dx ** 2 + dy ** 2;
        const maxDistance = 100;

        console.log("distanceSquared", distanceSquared);

        if (
          p.identity !== player.identity &&
          distanceSquared < maxDistance ** 2
        ) {
          nearbyPlayers.push(p);
        }
      });

      const rules: any[] = nearbyPlayers.map((p) => {
        return { type: "include", publisher: p.identity };
      });

      if (rules.length === 0) {
        rules.push({ type: "exclude", all: true });
      }

      console.log("rules", rules);

      twilioClient.video
        .rooms("cool-room")
        .participants.get(player.identity)
        .subscribeRules.update({
          rules,
        })
        .then((result) => {
          console.log("Subscribe Rules updated successfully", result);
        })
        .catch((error) => {
          console.log("Error updating rules", error);
        });
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

    this.onMessage("setIdentity", (client, data) => {
      this.state.setPlayerIdentity(client.sessionId, data);
    });

    lastFrameTime = Date.now() / 1000;
    lastRulesUpdateTime = lastFrameTime;

    setInterval(() => {
      const now = Date.now() / 1000;
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
app.get("/token", (req, res) => {
  const { identity, roomName } = req.query;

  const MAX_ALLOWED_SESSION_DURATION = 14400;

  const accessToken = new twilio.jwt.AccessToken(
    ACCOUNT_SID,
    API_KEY_SID,
    API_KEY_SECRET,
    {
      ttl: MAX_ALLOWED_SESSION_DURATION,
    }
  );
  (accessToken as any).identity = identity;
  const grant = new twilio.jwt.AccessToken.VideoGrant();
  (grant as any).room = roomName;
  accessToken.addGrant(grant);

  res.send(accessToken.toJwt());
  console.log(`issued token for ${identity} in room ${roomName}`);
});

const gameServer = new Server({
  server: createServer(app),
  express: app,
});

gameServer.define("main", MainRoom).enableRealtimeListing();

console.log("Listening on port", PORT);
gameServer.listen(Number(PORT));
