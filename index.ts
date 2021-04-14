import express from "express";

import { Room, Client, Server } from "colyseus";
import { Schema, type, MapSchema, SetSchema } from "@colyseus/schema";
import { createServer } from "http";
import * as _ from "lodash";

const PORT = process.env.PORT || 5000;

const sessionIdToIdentity = new Map<string, string>();

export class SharedApp extends Schema {
  @type("string")
  title = "";

  @type("string")
  name = "";

  @type("string")
  url = "";
}

export class Cursor extends Schema {
  @type("number")
  x: number;

  @type("number")
  y: number;

  @type("string")
  surfaceType: string;

  @type("string")
  surfaceId: string;
}

export class Player extends Schema {
  @type("number")
  color = _.sample([
    0xe6194b,
    0x3cb44b,
    0xffe119,
    0x4363d8,
    0xf58231,
    0x911eb4,
    0x46f0f0,
    0xf032e6,
    0xbcf60c,
    0xfabebe,
    0x008080,
    0xe6beff,
    0x9a6324,
    0xfffac8,
    0x800000,
    0xaaffc3,
    0x808000,
    0xffd8b1,
    0x000075,
    0x808080,
  ]);

  @type("string")
  name = "";

  @type("number")
  x = Math.floor(Math.random() * 16 * 32);

  @type("number")
  y = Math.floor(Math.random() * 16 * 32);

  @type("number")
  dir = 0;

  @type("number")
  speed = 0;

  @type("boolean")
  audioInputOn: boolean;

  @type("boolean")
  videoInputOn: boolean;

  @type("boolean")
  screenShareOn: boolean;

  @type(SharedApp)
  sharedApp: SharedApp;

  @type(Cursor)
  cursor: Cursor;

  @type("string")
  whisperingTo: string;
}

export class WorldObject extends Schema {
  @type("string")
  type: string;

  @type("number")
  x: number;

  @type("number")
  y: number;
}

export class State extends Schema {
  @type({ map: Player })
  players = new MapSchema<Player>();

  @type({ set: WorldObject })
  worldObjects = new SetSchema<WorldObject>();

  addWorldObject(worldObject: WorldObject) {
    this.worldObjects.add(worldObject);
  }

  createPlayer(identity: string, audioInputOn: boolean, videoInputOn: boolean) {
    console.log("Creating player:", identity);

    this.players.set(
      identity,
      new Player().assign({ audioInputOn, videoInputOn })
    );
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
}

export class MainRoom extends Room<State> {
  initWorld() {
    for (let i = 0; i < 16; i++) {
      for (let j = 0; j < 16; j++) {
        const dot = new WorldObject().assign({
          type: "dot",
          x: i * 32,
          y: j * 32,
        });
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

    this.onMessage("updatePlayer", (client, attributes) => {
      console.log("updating player", attributes);
      const identity = sessionIdToIdentity.get(client.sessionId);
      Object.assign(this.state.players.get(identity), attributes);
    });

    this.onMessage("updatePlayerCursor", (client, cursorData) => {
      console.log("updating cursor", cursorData);
      const identity = sessionIdToIdentity.get(client.sessionId);

      if (cursorData) {
        const cursor = new Cursor();
        cursor.x = cursorData.x;
        cursor.y = cursorData.y;
        cursor.surfaceType = cursorData.surfaceType;
        cursor.surfaceId = cursorData.surfaceId;
        this.state.players.get(identity).cursor = cursor;
      } else {
        delete this.state.players.get(identity).cursor;
      }
    });

    this.onMessage("cursorMouseDown", (client, mouseDownData) => {
      const identity = sessionIdToIdentity.get(client.sessionId);
      this.broadcast("cursorMouseDown", {
        cursorOwnerIdentity: identity,
        ...mouseDownData,
      });
    });

    this.onMessage("appInfo", (client, appInfo) => {
      const identity = sessionIdToIdentity.get(client.sessionId);
      const sharedApp = new SharedApp();
      sharedApp.name = appInfo.name;
      sharedApp.title = appInfo.title;
      sharedApp.url = appInfo.url;
      this.state.players.get(identity).sharedApp = sharedApp;
    });
  }

  onAuth(client: any, options: any, req: any) {
    return true;
  }

  onJoin(client: Client, options: any) {
    sessionIdToIdentity.set(client.sessionId, options.identity);
    this.state.createPlayer(
      options.identity,
      options.audioInputOn,
      options.videoInputOn
    );
  }

  onLeave(client: Client) {
    const identity = sessionIdToIdentity.get(client.sessionId);
    this.state.removePlayer(identity);
    sessionIdToIdentity.delete(client.sessionId);
  }

  onDispose() {
    console.log("dispose");
  }
}

const app = express();
app.use(express.json());

const gameServer = new Server({
  server: createServer(app),
  express: app,
});

gameServer.define("main", MainRoom).enableRealtimeListing();

console.log("Listening on port", PORT);
gameServer.listen(Number(PORT));
