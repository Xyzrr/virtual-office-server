import express from "express";

import { Room, Client, Server } from "colyseus";
import { Schema, type, MapSchema, SetSchema } from "@colyseus/schema";
import { createServer } from "http";
import twilio, { Twilio } from "twilio";
import * as _ from "lodash";

const PORT = process.env.PORT || 5000;

const ACCOUNT_SID = "AC38ede87c7601fb1e80347d0fb358965f";
const API_KEY_SID = "SKb1583de43dafe4f8076f477383342990";
const API_KEY_SECRET = "i4BcXHV8nAB1Vxn1kguNOsa5vpaMhK50";

const twilioClient = new Twilio(API_KEY_SID, API_KEY_SECRET, {
  accountSid: ACCOUNT_SID,
});

const sessionIdToIdentity = new Map<string, string>();

export class Player extends Schema {
  constructor(audioEnabled: boolean) {
    super();
    this.audioEnabled = audioEnabled;
  }

  @type("number")
  color = _.sample([0xffffff, 0xcdf6d1, 0xfc7150, 0x50dcfd, 0xf66760]);

  @type("number")
  x = Math.floor(Math.random() * 16);

  @type("number")
  y = Math.floor(Math.random() * 16);

  @type("number")
  dir = 0;

  @type("number")
  speed = 0;

  @type("boolean")
  audioEnabled: boolean;
}

export class WorldObject extends Schema {
  constructor(type: string, x: number, y: number) {
    super();
    this.type = type;
    this.x = x;
    this.y = y;
  }

  @type("string")
  type: string;

  @type("number")
  x: number;

  @type("number")
  y: number;
}

export class Cursor extends Schema {
  @type("number")
  x: number;

  @type("number")
  y: number;

  @type("string")
  cursorOwnerIdentity: string;

  @type("string")
  screenOwnerIdentity: string;
}

export class State extends Schema {
  @type({ map: Player })
  players = new MapSchema<Player>();

  @type({ set: WorldObject })
  worldObjects = new SetSchema<WorldObject>();

  @type({ set: Cursor })
  cursors = new SetSchema<Cursor>();

  addWorldObject(worldObject: WorldObject) {
    this.worldObjects.add(worldObject);
  }

  createPlayer(identity: string, audioEnabled: boolean) {
    console.log("Creating player:", identity);
    this.players.set(identity, new Player(audioEnabled));
  }

  removePlayer(identity: string) {
    console.log("Removing player:", identity);
    this.players.delete(identity);
  }

  setPlayerPosition(identity: string, x: number, y: number) {
    const player = this.players.get(identity);
    player.x = x;
    player.y = y;
  }

  setPlayerDirection(identity: string, dir: number) {
    const player = this.players.get(identity);
    player.dir = dir;
  }

  setPlayerSpeed(identity: string, speed: number) {
    const player = this.players.get(identity);
    player.speed = speed;
  }

  setPlayerAudioEnabled(identity: string, audioEnabled: boolean) {
    const player = this.players.get(identity);
    player.audioEnabled = audioEnabled;
  }
}

export class MainRoom extends Room<State> {
  maxClients = 4;
  interval: any = undefined;

  initWorld() {
    for (let i = 0; i < 16; i++) {
      for (let j = 0; j < 16; j++) {
        const dot = new WorldObject("dot", i, j);
        this.state.addWorldObject(dot);
      }
    }
  }

  onCreate(options: any) {
    console.log("room created", options);

    this.setState(new State());

    this.initWorld();

    this.onMessage("setPlayerDirection", (client, dir) => {
      const identity = sessionIdToIdentity.get(client.sessionId);
      this.state.setPlayerDirection(identity, dir);
    });

    this.onMessage("setPlayerSpeed", (client, speed) => {
      const identity = sessionIdToIdentity.get(client.sessionId);
      this.state.setPlayerSpeed(identity, speed);
    });

    this.onMessage("setPlayerPosition", (client, position) => {
      const identity = sessionIdToIdentity.get(client.sessionId);
      this.state.setPlayerPosition(identity, position.x, position.y);
    });

    this.onMessage("setPlayerAudioEnabled", (client, audioEnabled) => {
      const identity = sessionIdToIdentity.get(client.sessionId);
      this.state.setPlayerAudioEnabled(identity, audioEnabled);
    });

    this.onMessage("setCursorPosition", (client, cursorData) => {
      const { x, y, screenOwnerIdentity } = cursorData;
      const identity = sessionIdToIdentity.get(client.sessionId);

      for (const cursor of this.state.cursors.values()) {
        if (cursor.cursorOwnerIdentity === identity) {
          cursor.x = x;
          cursor.y = y;
          cursor.screenOwnerIdentity = screenOwnerIdentity;
          return;
        }
      }

      this.state.cursors.add({ ...cursorData, cursorOwnerIdentity: identity });
    });

    this.onMessage("removeCursor", (client) => {
      const identity = sessionIdToIdentity.get(client.sessionId);
      for (const cursor of this.state.cursors.values()) {
        if (cursor.cursorOwnerIdentity === identity) {
          this.state.cursors.delete(cursor);
          return;
        }
      }
    });

    this.interval = setInterval(() => {
      for (const [identity, player] of this.state.players.entries()) {
        const nearbyPlayers: { [id: string]: Player } = {};
        for (const [id, p] of this.state.players.entries()) {
          if (p === player) {
            return;
          }

          const dx = p.x - player.x;
          const dy = p.y - player.y;

          const distance = Math.sqrt(dx ** 2 + dy ** 2);
          const maxDistance = 10;

          if (distance < maxDistance) {
            nearbyPlayers[id] = p;
          }
        }

        const rules: any[] = Object.entries(nearbyPlayers).map(([id, p]) => {
          return { type: "include", publisher: id };
        });

        if (rules.length === 0) {
          rules.push({ type: "exclude", all: true });
        }

        console.log("rules", identity, rules);

        twilioClient.video
          .rooms("cool-room")
          .participants.get(identity)
          .subscribeRules.update({
            rules,
          })
          .then((result) => {
            console.log("Subscribe Rules updated successfully", result);
          })
          .catch((error) => {
            console.log("Error updating rules", error);
          });
      }
    }, 1000);
  }

  onAuth(client: any, options: any, req: any) {
    return true;
  }

  onJoin(client: Client, options: any) {
    sessionIdToIdentity.set(client.sessionId, options.identity);
    this.state.createPlayer(options.identity, options.audioEnabled);
  }

  onLeave(client: Client) {
    const identity = sessionIdToIdentity.get(client.sessionId);
    this.state.removePlayer(identity);
    sessionIdToIdentity.delete(client.sessionId);
  }

  onDispose() {
    clearInterval(this.interval);
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
