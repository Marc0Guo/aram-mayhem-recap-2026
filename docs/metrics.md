# Metric definitions

Every dashboard number joins the selected account's own participant to completed, classified Mayhem matches in the half-open interval `[startUtc, endUtc)`. Dates are interpreted in the selected Windows timezone, including DST. Unknown is an em dash, never zero.

- Games: completed matches in the interval.
- Win rate: wins / (wins + losses), one decimal, with the denominator. Remakes and unknown outcomes are separate. An empty denominator is an em dash.
- Playtime: sum of known durations greater than zero, with N.
- Aggregate KDA: (sum of kills + sum of assists) / sum of deaths, using only rows where all three are known. It is not the mean of per-game ratios. Zero total deaths is Perfect, and the numerator is shown.
- Damage per minute: total valid champion damage / total valid duration minutes on the same rows. Missing or zero duration is excluded, with N.
- Champion sort: games descending, wins descending, champion id ascending. Favorite means most played.
- Augment frequency: each id once per match. Denominator is matches with recorded or explicit-none augments. No win rate, tier, or recommendation.
- Final inventory: unique nonzero item ids per readable inventory. A duplicate slot counts once. This is not a purchase order.
- Activity: selected local calendar day. An empty day is not proof that nobody played.
- Longest win streak: chronological explicit wins. A loss, remake, unknown outcome, or known coverage gap breaks it.

Copy stays "among your stored matches." A successful scan is not a complete week or year.
