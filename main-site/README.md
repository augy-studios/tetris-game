# pwa-tetris
Augy Studios PWA sites tetris
Note: The `/api` folder is meant for Vercel serverless functions. Remove if not required.

## Instant replay

When a game ends it plays back on the board by itself (Settings turns this
off), every piece falling, turning and sliding as it was played. Play, pause,
the slider, and a step back or forward a piece at a time, which lands on each
piece where it locked. It plays at 0.5x, 1x, 2x or 4x, remembered in this
browser, as in the word rain game.

## Sharing a replay

Share, in the replay, makes a link such as `/?r=gVWNSwrC...` through the
device's share sheet where it has one and the clipboard otherwise. As with
the chess game's links, the link is the whole game and nothing is stored
anywhere, so it opens offline once the site has been visited:

- each lock is its place in the list of spots the piece could have dropped
  straight to, best first by the autoplay's scoring, so a sound move is a
  small number (a tuck under an overhang is spelt out instead);
- times are kept to 0.1 s up to 5 minutes, then 0.2 s, 0.5 s and 1 s for
  longer games;
- the lot is deflated, so a 10 minute game is about 1,000 characters, and
  the cost per piece falls the longer the game runs.

`LINK_WEIGHTS` in `script.js` is frozen: links already shared rank their
spots with it. A shared replay shows where each piece locked and works out a
path there; the instant replay of your own game shows the moves you made.

## Versus

Per `STUN-p2p-spec.md` (`js/net.js` is its reference module): STUN only, no
TURN relay, so **both devices have to be on the same network**, the same
wifi or one sharing a hotspot with the other. PeerJS loads from cdnjs only
when somebody hosts or joins, and is never cached.

One device hosts and shows a code, a link (`/?join=CODE`) and a QR code; the
other joins. Both play their own board from the host's seed. Clearing 2, 3
or 4 lines sends 1, 2 or 4 rows of garbage, which first cancels garbage on
its way to you; garbage lands when you next lock a piece without clearing a
line. The first to top out loses. The host runs the match (`js/versus.js`);
each device sends its board 20 times a second, with garbage as a running
total so a lost message costs nothing. While a match is on, the opponent's
board is recorded on your game's clock, so the instant replay plays it back
beside yours.

Matches are ranked, each board's game on its own. The server cannot tell
garbage a real opponent sent from garbage a log made up, so **a row with
garbage in it scores nothing and counts as no line** (it still counts as
attack). Made-up garbage then only gets in the way, and the server checks a
match's log without knowing the other board.
