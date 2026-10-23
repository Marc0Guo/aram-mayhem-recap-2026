# Visual asset sources

Verified 2026-10-23. Background bundled locally for offline rendering.

- Riot article: https://www.leagueoflegends.com/en-us/news/dev/dev-bringing-mayhem-to-aram/
- Map image from that article: https://cmsassets.rgpub.io/sanity/images/dsfx7636/news_live/64aced862fc2877fa99733d5d74c40a29c7f2b07-1505x847.jpg
- Local file: src/renderer/src/assets/mayhem-background.jpg
- Augment names and rarity snapshot: CommunityDragon 16.21, global/default/v1/cherry-augments.json and global/zh_cn/v1/cherry-augments.json. Full base https://raw.communitydragon.org/16.21/plugins/rcp-be-lol-game-data/
- Bundled metadata: src/shared/augment-catalog.json. kSilver, kGold and kPrismatic are mapped explicitly. kEventChoice and unknown IDs remain unclassified. No tier inferred from names or IDs.

Riot game art remains owned by Riot Games. Public redistribution remains subject to project release-policy review.

Checks: renderer/main TypeScript checks, changed-file ESLint, 38 tests and production build pass. Screenshot/UI language verification recorded separately in the working chat.

Bundled first-visible augment icons under src/renderer/src/assets/augments/: 20 metadata-matched icon files from the same pinned 16.21 provider, covering the currently most-used names. Other IDs use the existing cache pipeline and a tier-colored placeholder if unavailable. Champion/item bilingual fallback names are bundled from Data Dragon 16.21.1.
