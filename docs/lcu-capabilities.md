# LCU capability observations

Date: 2026-10-21. Adapter version: `lcu-2026-10-21`. A signed-in local client was read. No lockfile contents, passwords, PUUIDs, summoner names, or command lines are recorded here.

## What was observed

`LeagueClient.exe` and `LeagueClientUx.exe` were running, and the default lockfile was present. Discovery state was `found`. Port 2999 was not used.

`GET /lol-summoner/v1/current-summoner` returned 200. The payload has `puuid`, `gameName`, and `tagLine`. It does not have `platformId`. The match-history wrapper does: the observed region was `NA1`. The account platform is taken from that wrapper when the summoner payload omits it.

`GET /lol-match-history/v1/products/lol/{puuid}/matches` returned 200 with shape `{ games: { games: [] } }`. Nested fields include `gameCount`, `gameIndexBegin`, and `gameIndexEnd`. Each list game includes `gameId`, `gameCreation`, `gameDuration`, `queueId`, `gameMode`, `participantIdentities`, and `participants`.

The history plugin forwards `begIndex` as the remote `startIndex` and an inclusive `endIndex` as the remote `count` (`count = endIndex - begIndex + 1`). `begIndex=0&endIndex=199` requested `startIndex=0&count=200` and returned 200 games dated 2026-09-26 through 2026-10-21. After that id cache expired, `begIndex=200&endIndex=399` requested `startIndex=200&count=200` and returned a different 200 games dated 2026-08-23 through 2026-09-26. `gameCount` on the response is the size of that page, not the player's total history. Passing `startIndex` on the localhost URL returns HTTP 400; only `begIndex` and `endIndex` are accepted.

The client stores one match-id page. While that page is cached, a different `begIndex` returns the cached page in about 100ms, keeps the cached `gameIndexBegin` and `gameIndexEnd`, and does not make a new remote query. The cache lasted several minutes on 2026-10-21. A short request such as `endIndex=1` replaces the cached page with 2 games. The live list therefore asks for an inclusive window of 199 and, when the labeled window is a different page, keeps those games and retries the requested window until the cache expires. A fast 2-game page at index 0 is that stale cache, not the end of history.

Queue counts in the newest 200-game window: 2400 matched KIWI 147, 3270 custom KIWI 27, 1750 Arena 25, 1740 Arena 1. The next window was 2400 matched KIWI 158, 3270 custom KIWI 27, 1750 Arena 10, 1740 Arena 5. Only queue 2400 stays confirmed Mayhem.

Those two games were queue `2400`, `gameMode` `KIWI`, `gameType` `MATCHED_GAME`, map `12`, mutator `mapskin_ha_bilgewater`, and `endOfGameResult` `GameComplete`. `gameVersion` was `16.20.824.8524`. `gameCreation` values were epoch milliseconds. `gameDuration` values were integers from 1122 to 1522, treated as seconds.

`GET /lol-match-history/v1/games/{gameId}` returned 200 with the same game fields. The detail has 10 `participantIdentities` and 10 `participants`. The list copy of a game had one participant. Self linkage works: `participantIdentities[].player.puuid` matches the current summoner, and that `participantId` is on `participants[]`.

`participants[].stats` includes `kills`, `deaths`, `assists`, `win`, `totalDamageDealtToChampions`, `goldEarned`, `item0` through `item6`, and `playerAugment1` through `playerAugment6`. Both games had at least one augment slot above zero. A zero slot is an empty slot, not a selected augment. Nine distinct positive augment ids appeared. Missing augment keys stay unavailable. Perk ids are not treated as augments.

Queue 2400 is confirmed Mayhem from this evidence: the candidate queue, mode `KIWI` rather than `ARAM`, self linkage, and populated augment slots. Map 12 alone is not the reason. Ordinary ARAM queue 450 was not in this page. `REAL_CLIENT_IMPORT_VERIFIED` is true. The sanitized detail is `fixtures/lcu/mayhem.sanitized.json`.

## Still unresolved

Later windows were fetched the same way: after the id cache expired, `startIndex=400`, `600`, and `800` each returned 200 games. The import keeps asking for the next window until a short page. A checked database during that walk held Mayhem games back to 2026-02-24 and was still committing. Augment ids are stored as the numeric `playerAugment` values. Their CommunityDragon images are not pinned, so `assets:verify` still fails the image gate. A clean Windows VM install was not run.

## Profile and recap fields verified 2026-10-23

Read-only current-client probes returned 200 for /lol-summoner/v1/current-summoner, /lol-champion-mastery/v1/local-player/champion-mastery, and /lol-champion-mastery/v1/local-player/champion-mastery-score. Only profileIconId, summonerLevel, championId/championLevel/championPoints and mastery score are cached as the per-account profile setting. No credentials or PUUID are added to that profile JSON. Mastery values describe the current account, not a historical date-filtered snapshot.

PersistedSettings.json in the League installation Config folder exposes Input.ini > GameEvents > evtCastAvatarSpell1/2. Confirmed bindings D and F. Flash uses summoner spell ID 4; the UI reports the most common recorded flash slot in the selected range, mapped to the configured key. No default binding is guessed when configuration is unavailable. This is a historical preference indicator, not live game detection.

Stored sanitized participantIdentities retain player.profileIcon and pseudonymous playerKey. The teammate list uses the most frequently observed profileIcon across the selected stored games. This is a recorded icon, not a claim that it is their currently equipped icon. Missing icons use a neutral placeholder and never a champion portrait. Account profile icon uses the current-summoner value.

Verified icon resource example: https://raw.communitydragon.org/16.21/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons/6504.jpg . These follow the existing version-pinned cache pipeline. Mastery crest resources were downloaded from https://raw.communitydragon.org/16.21/game/assets/ux/mastery/legendarychampionmastery/masterycrest_level10.png and corresponding level0,4,5,6,7,8,9 files. Level 10 art is used for levels 10 and above; the actual numeric level remains visible.

Highlight DTO now carries durationText from the same selected maximum-stat game. Champion extras sum raw pentaKills, quadraKills and tripleKills for the account's self participant. Missing stats remain unknown. Most Played follows the reference field order; its match statistics obey the chosen range while mastery is explicitly current account data.

Verification: 39 tests, renderer/main TypeScript checks, changed-file ESLint and production build passed. Preview on port 4174 loads the new backend DTOs; the previous port 4173 process remains unchanged. This preview can read cached real records and fetched profile data, but process-based discovery is restricted by this execution environment. It must not be described as a confirmed live sync run.

## Official ARAM challenge ownership verified 2026-10-23

GET /lol-challenges/v1/challenges/local-player returned HTTP 200 with an id-keyed object. It supplies currentLevel, currentValue, percentile (percentage units, including fractions), position, gameModes, isCapstone, names and descriptions. The summary-player-data/local-player and challenges/config candidate paths returned 404 and are unused.

The profile adapter stores only earned non-capstone ARAM challenge ids, names, descriptions, level, value, percentile and positive rank. It drops friend lists and every identity field. Invalid/negative/zero positions are omitted; negative values are never converted to a positive rank. Lowest percentile first, then highest tier, then id; display at most 12. These are lifetime account achievements shared across supported ARAM modes, independent of the match date filter. Current verified level token assets and bilingual metadata are pinned in owned-challenge-assets.json and challenge-catalog.json. Cached data remains available offline; refresh failure retains the previous challenge cache.

The LCU JSON parser now accepts finite fractional values such as rarity 0.1 while still preserving oversized integer tokens and rejecting unsafe numeric integers. Tests cover parsing, earned-only filtering, rarity ties, invalid ranks, privacy projection and complete-team denominators.

Unavailable fun-stat cards are omitted. Pings has been removed from the recap UI. Available match stats supply healing, mitigation, gold earned, crowd-control seconds and turret damage maxima, together with active-day playtime, team damage share and average champion damage. The reference summary uses total takedowns in the time-dead position because time spent dead is absent in observed match stats.
