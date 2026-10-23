# Synchronization

One run starts when the real app opens, and manual refresh uses the same controller. There is no timer after the window closes. A second start for the same account joins the active run. Manual refresh waits at least 30 seconds. Launch, continue, and rebuild are not throttled.

The live client uses an inclusive page of 200 games. `endIndex = begIndex + 199`, which the client sends as `startIndex=begIndex` and `count=200`. It keeps only the last fetched id page for several minutes, and a different range returns that cached page until the cache expires. The sync retries a window whose `gameIndexBegin` does not match, and it stores games from the other cached page instead of dropping them. A fast two-game page at index 0 is that stale cache. Fixture tests still use a page of 20 and end-exclusive indexes.

An incremental run starts at the newest page. A backfill resumes one page before the offset it had reached, so a restarted import does not wait through every earlier window again. Pending ids are diagnostic. A match inserted between pages is deduplicated on a later walk.

The default budget is 500 charged entries or 120 seconds. The live import uses 10000 charged entries or 4 hours so one open session can keep walking older pages. Charged entries are ids that still need work: unknown, incomplete, due for retry, overlap revalidation, or every listed id during rebuild. Already complete rows are walked for dedupe and are not charged. Time still applies to the whole run. Stopping for budget, cancel, a changed account, HTTP 403, or offline does not advance `last_successful_scan`. An empty page with no failures, or a repeated page that covers the client-reported count, does.

Incremental stop requires the newest 40 known matches to be revalidated and two following pages with nothing left to fetch. An empty page, or two identical pages, ends with that reason. A 404 marks that detail unavailable and does not delete a stored game.

Detail fetches use at most two at a time and 100 ms between starts. Transient HTTP 500 and network errors get three attempts, delayed 1s and 2s plus jitter. HTTP 429 waits for Retry-After inside the time budget. HTTP 401 rediscovers the lockfile once. HTTP 403 is a capability failure.
