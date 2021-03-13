# Harbor - Colyseus

This is the [Colyseus](https://www.colyseus.io/) server for Harbor. It's responsible for processing user inputs and synchronizing game state across clients. It doesn't handle media streams; this server is intentionally independent from the video call providers.

## Setting up

Just clone and install dependencies with:

```sh
npm install
```

## Starting Development

```sh
npm start
```

Your app should now be running on [localhost:5000](http://localhost:5000/).

## Deploying

Currently hosted on the Heroku app virtual-office-server. To deploy, after dealing with the authentication stuff:

```
git push heroku main
```
