# ADR-0001: LCU match history is the forward-capture source

**Status:** Accepted (2026-07-18)

## Context

The app needed a way to record completed games. Three sources were available.

**Live Client Data API** (`https://127.0.0.1:2999`) — already polled every 2s by
`src/gamestate.js`. But it is served by the *game process*, which closes port 2999 within a
second or two of the game ending. Capturing a final snapshot means racing a closing socket
against a 2000ms poll interval. Worse, the payload has no match identifier and no outcome:
Riot's published [sample events file](https://static.developer.riotgames.com/docs/lol/liveclientdata_events.json)
documents 11 event types (`GameStart`, `ChampionKill`, `TurretKilled`, `BaronKill`, `Ace`, …)
and **no `GameEnd` event**. A match history built on it could not tell you whether you won.

**LCU** (League *client*) — already used by `src/lcu.js`, with working lockfile/process-args
auth discovery and a generic `request()` helper. `gameflowPhase()` already reports
`WaitingForStats` and `EndOfGame`.

**Riot Web API** (`match-v5`) — richest, but requires a key, and personal dev keys expire
every 24 hours.

## Decision

Use the **LCU** as the source for ongoing forward capture.

Two endpoints, empirically verified against a live client:

- `/lol-match-history/v1/products/lol/current-summoner/matches` — lists recent matches, but
  returns **only the current player's participant row** (`participants.length === 1`).
- `/lol-match-history/v1/games/{gameId}` — returns the **full 10-player match**
  (`participants: 10`, `participantIdentities: 10`, ~31 KB), plus a `teams` block with bans,
  `firstBlood`, `firstTower`, and objective counts.

So: list to discover Match IDs, then one detail fetch per Match.

`/lol-gameflow/v1/session` supplies `gameData.gameId` **during** the game, which is the join
key for the Coaching Record (see [ADR-0005](0005-history-ui-immune-to-phase.md) context and
the spec).

## Consequences

- No game-end race. Matches persist in the client for the session; a missed poll is harmless.
- No API key on the ongoing path. The app stays keyless in normal operation.
- Requires two calls per Match rather than one.
- **The LCU is a session cache, not an archive** — see
  [ADR-0003](0003-one-time-match-v5-import.md), which exists entirely because of this.
- LCU payloads are the older match-v4-shaped schema (`participants[].stats.win`,
  `timeline.csDiffPerMinDeltas`), which differs from `match-v5`. Two normalizers are required.
