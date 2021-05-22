import express, { ErrorRequestHandler } from "express";

import { Room, Client, Server, matchMaker, LobbyRoom } from "colyseus";
import { Schema, type, MapSchema, SetSchema } from "@colyseus/schema";
import { createServer } from "http";
import * as _ from "lodash";
import admin from "firebase-admin";
import serviceAccountKey from "./serviceAccountKey.json";
import { v4 as uuid } from "uuid";

const PORT = process.env.PORT || 5000;

admin.initializeApp({
  credential: admin.credential.cert(serviceAccountKey as any),
});

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
  color = 0;

  @type("string")
  name = "";

  @type("string")
  photoUrl = "";

  @type("number")
  x = Math.floor(Math.random() * 16 * 16);

  @type("number")
  y = Math.floor(Math.random() * 16 * 16);

  @type("number")
  dir = 0;

  @type("number")
  speed = 0;

  @type("boolean")
  audioInputOn: boolean;

  @type("boolean")
  audioOutputOn: boolean;

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

  @type("boolean")
  connected = true;
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
  @type("string")
  spaceName: string;

  @type({ map: Player })
  players = new MapSchema<Player>();

  @type({ map: WorldObject })
  worldObjects = new MapSchema<WorldObject>();

  addWorldObject(id: string, worldObject: WorldObject) {
    this.worldObjects.set(id, worldObject);
  }

  createPlayer(
    identity: string,
    name: string,
    photoUrl: string | null,
    color: number,
    audioInputOn: boolean,
    audioOutputOn: boolean,
    videoInputOn: boolean
  ) {
    console.log("Creating player:", identity);

    this.players.set(
      identity,
      new Player().assign({
        name,
        photoUrl,
        color,
        audioInputOn,
        audioOutputOn,
        videoInputOn,
      })
    );
  }

  removePlayer(identity: string) {
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
  autoDispose = false;

  initWorld(hollow: boolean) {
    for (let i = 0; i < 16; i++) {
      for (let j = 0; j < 16; j++) {
        if (hollow) {
          if (i !== 0 && j !== 0 && i !== 15 && j !== 15) {
            continue;
          }
        }

        const dot = new WorldObject().assign({
          type: "dot",
          x: i * 16,
          y: j * 16,
        });
        this.state.addWorldObject(uuid(), dot);
      }
    }
  }

  onCreate(options: any) {
    console.log("ROOM CREATED:", options);

    this.setState(new State().assign({ spaceName: options.spaceName }));

    this.setMetadata({
      spaceId: options.spaceId,
      spaceName: options.spaceName,
    });
    this.initWorld(options.spaceId === "night");

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

    this.onMessage("chatMessage", (client, message) => {
      console.log("Received chat message:", message);
      const identity = sessionIdToIdentity.get(client.sessionId);
      this.broadcast("chatMessage", {
        senderIdentity: identity,
        ...message,
      });
    });

    this.onMessage("startMessage", (client, message) => {
      console.log("Started chat message:", message);
      const identity = sessionIdToIdentity.get(client.sessionId);
      this.broadcast("startMessage", {
        senderIdentity: identity,
        ...message,
      });
    });

    this.onMessage("messageOperations", (client, message) => {
      console.log("Received chat operations:", message);
      const identity = sessionIdToIdentity.get(client.sessionId);
      this.broadcast("messageOperations", {
        senderIdentity: identity,
        ...message,
      });
    });

    this.onMessage("finishMessage", (client, options) => {
      console.log("Finished chat message:", options);
      const identity = sessionIdToIdentity.get(client.sessionId);
      this.broadcast("finishMessage", {
        senderIdentity: identity,
        ...options,
      });
    });

    this.onMessage("deleteMessage", (client, options) => {
      console.log("Deleted chat message:", options);
      const identity = sessionIdToIdentity.get(client.sessionId);
      this.broadcast("deleteMessage", {
        senderIdentity: identity,
        ...options,
      });
    });

    this.onMessage("command", (client, options) => {
      console.log("Received command:", options);
      const identity = sessionIdToIdentity.get(client.sessionId);
      this.broadcast("command", {
        senderIdentity: identity,
        ...options,
      });
    });
  }

  onAuth(client: any, options: any, req: any) {
    console.log("Heres what im working with", client, options, req);
    return true;
  }

  onJoin(client: Client, options: any) {
    console.log("CLIENT JOINED:", options);
    sessionIdToIdentity.set(client.sessionId, options.identity);
    this.state.createPlayer(
      options.identity,
      options.name,
      options.photoUrl,
      options.color,
      options.audioInputOn,
      options.audioOutputOn,
      options.videoInputOn
    );
  }

  async onLeave(client: Client, consented: boolean) {
    const identity = sessionIdToIdentity.get(client.sessionId);
    if (consented) {
      console.log("Removing player consensually:", identity);
      this.state.removePlayer(identity);
      sessionIdToIdentity.delete(client.sessionId);
    } else {
      console.log("Player disconnected:", identity);
      try {
        this.state.players.get(identity).connected = false;
        await this.allowReconnection(client, 20);
        this.state.players.get(identity).connected = true;
        console.log("Player successfully reconnected:", identity);
      } catch (e) {
        console.log("Removing player without consent:", identity);
        sessionIdToIdentity.delete(client.sessionId);
        if (!this.state.players.get(identity).connected) {
          this.state.removePlayer(identity);
        }
      }
    }
  }

  onDispose() {
    console.log("DISPOSED");
  }
}

const app = express();
app.use(express.json());

app.get("/create-custom-token", async (req, res, next) => {
  let decodedToken: admin.auth.DecodedIdToken;
  try {
    decodedToken = await admin.auth().verifyIdToken(req.query["id"].toString());
  } catch (e) {
    next(e);
    return;
  }

  let customToken: string;
  try {
    customToken = await admin.auth().createCustomToken(decodedToken.uid);
  } catch (e) {
    next(e);
    return;
  }

  res.send(customToken);
});

const gameServer = new Server({
  server: createServer(app),
  express: app,
});

gameServer
  .define("main", MainRoom)
  .filterBy(["spaceId"])
  .enableRealtimeListing();

gameServer.define("lobby", LobbyRoom);

matchMaker.createRoom("main", {
  spaceId: "wandb-growth",
  spaceName: "W&B Growth",
});
matchMaker.createRoom("main", {
  spaceId: "welcome",
  spaceName: "Welcome Harbor",
});
matchMaker.createRoom("main", {
  spaceId: "night",
  spaceName: "Night Lounge",
});

console.log("Listening on port", PORT);
gameServer.listen(Number(PORT));
