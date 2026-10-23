# LCU fixtures

`candidate-*.synthetic.json` files are synthetic. They are not client captures.

`mayhem.sanitized.json` is one detail from the local client on 2026-10-21. Account identifiers, summoner names, the match-history URI, and the original game id were removed. The replacement game id is `sanitized-mayhem-1`, and the local player is marked `puuid: "self"`.

Queue 2400 is confirmed from that file together with the observations in `docs/lcu-capabilities.md`. `gameMode` was `KIWI`. A `gameMode` of `ARAM`, or map 12 by itself, still does not classify a queue as Mayhem.
