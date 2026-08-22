# League of Legends Marksman items — patch 26.15

Research date: 2026-08-02  
Live Riot patch: **26.15**  
Data Dragon build: **16.15.1**

## Executive summary

The live client has **26 purchasable completed items** carrying Riot's Marksman shop-class flag. The flag is not the same thing as “has crit” or “is good on every ADC”: several completed items are shared with Fighter, Assassin, or Mage, and some are deliberately on-hit or defensive alternatives.

For Caitlyn, the cleanest mechanical fits are the items that amplify critical strikes, long-range first hits, and high-AD burst: **Infinity Edge, Hexoptics C44, Stormrazor, Rapid Firecannon, Lord Dominik's Regards, Yun Tal Wildarrows, The Collector, Bloodthirster**, plus the appropriate defensive item. **Blade of the Ruined King, Guinsoo's Rageblade, Terminus, Wit's End, Nashor's Tooth, Statikk Shiv, Kraken Slayer, and Manamune** are genuine Marksman-tab items, but they steer Caitlyn away from the crit/Headshot pattern that her kit explicitly rewards.

This is a mechanics report, not a claim about live pick rate or a single fixed six-item build. “Caitlyn read” below is analysis from her current Riot tooltip and item mechanics.

## Scope and classification method

Riot's public patch is [26.15](https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-15-notes/), published July 28, 2026. Riot's NA realm points item and champion data to [Data Dragon 16.15.1](https://ddragon.leagueoflegends.com/realms/na.json); the separate [versions feed](https://ddragon.leagueoflegends.com/api/versions.json) also lists 16.15.1 first. The two major numbers are therefore intentionally reported as Riot exposes them rather than “corrected” to match.

The official [Data Dragon documentation](https://developer.riotgames.com/docs/lol) explains that item data includes descriptions, costs, recipes, and stats. Its `tags` field is a stat/search taxonomy, however, not the in-game class-tab membership. The shipped client item data exposes class membership as `ItemData.mItemAttributes`; the value **2** is Marksman. This mapping is corroborated across unambiguous records: Infinity Edge and Kraken Slayer are `[2]`, The Collector is `[2,4]` (Marksman + Assassin), Bloodthirster is `[2,1]` (Marksman + Fighter), Rabadon's Deathcap is `[16]`, Sunfire Aegis is `[8]`, and Redemption is `[32]`. The client also contains a dedicated `MarksmanItemsFilterButtonDefinition`.

Because Riot does not publish those client bins through a first-party web API, the classification evidence is the patch-pinned CommunityDragon extraction of Riot's shipped assets: [item definitions](https://raw.communitydragon.org/16.15/game/items.cdtb.bin.json), [shop UI definition](https://raw.communitydragon.org/16.15/game/gameplay.itemshop.bin.json), and [normalized localized item records](https://raw.communitydragon.org/16.15/plugins/rcp-be-lol-game-data/global/default/v1/items.json). CommunityDragon is a community-operated mirror/extractor, not a Riot service; the underlying records are Riot client assets. Costs, visible stats, names, and icons are independently available in Riot's [16.15.1 item JSON](https://ddragon.leagueoflegends.com/cdn/16.15.1/data/en_US/item.json).

The principal inventory below means:

- `mItemAttributes` contains Marksman (`2`);
- `mInStore` is true;
- the item is the normal base ID, item-set-visible, and purchasable;
- completed/Legendary tier (`epicness = 5`);
- deprecated ID 3095 and alternate-mode/upgraded duplicate IDs are excluded.

This produces **26 completed items**. Shared basics, starters, boots, and components that also carry the Marksman flag are listed later. The report does not count Muramana as a separately purchasable item: it is Manamune's automatic transformation.

## Caitlyn baseline for reading the table

Riot's current [Caitlyn champion JSON](https://ddragon.leagueoflegends.com/cdn/16.15.1/data/en_US/champion/Caitlyn.json) gives her **650 base attack range** and says **Headshot's bonus damage scales with critical-strike chance**. A trapped or netted target also grants an empowered Headshot at doubled attack range. Those facts drive three useful principles:

1. Crit is not merely a generic ADC stat on Caitlyn; it directly scales Headshot.
2. Long-range first-hit effects are easier for her to deliver safely than for most marksmen.
3. She can naturally pair spell casts (especially E and triggered W) with empowered attacks, but items with no AD and no crit still pay a real opportunity cost.

## Completed item reference

### Crit and long-range burst items

| Item | Exact live stats and effect | General use | Caitlyn read |
|---|---|---|---|
| **Infinity Edge** — 3500g | 75 AD, 25% crit, +30% crit damage. | The crit damage capstone: buy when attacks and crit-scaling abilities are the damage plan. It becomes better as the rest of the build supplies more crit. | **Excellent/core fit.** It simultaneously increases attack crits and supports Headshot's crit scaling. Expensive and offers no defense, so the timing depends on whether Caitlyn can safely convert damage. |
| **Yun Tal Wildarrows** — 3000g | 50 AD, 45% AS, starts at 0% crit. Each attack permanently grants 0.4% crit for melee / 0.2% for ranged, up to 25% (63 / 125 attacks). Attacking a champion grants 30% AS for 6s (30s cooldown); attacks reduce that cooldown by 1s, crits by 2s. Patch 26.15 raised AS from 40% to 45% and reduced combine cost by 100g. | A scaling first-item-style purchase for an auto-attacker who can accumulate the permanent crit and repeatedly cycle Flurry. It is weaker at the instant of purchase than a 25%-crit item. | **Strong scaling option.** Caitlyn's range helps her stack and trigger it, and the finished 25% crit benefits Headshot. Choose it when the lane/game gives time to ramp; avoid treating its purchase-time 0% crit as already complete. |
| **Hexoptics C44** — 2800g | 55 AD, 25% crit. Attacks deal up to 10% increased damage based on distance (maximum at 500 units). If a champion damaged within 3s dies, gain 100 attack range for 8s. | A long-range damage multiplier and takedown-reset range tool. Best on champions who can consistently attack from at least 500 units rather than being forced into close quarters. | **Excellent fit.** Caitlyn's 650 base range can reliably reach the 10% ceiling. A takedown pushes ordinary attack range to 750 for 8s, enhancing cleanup and target access. |
| **Stormrazor** — 3200g | 50 AD, 20% AS, 25% crit. At 100 Energize, the next attack deals 100 bonus magic damage and grants 45% bonus move speed for 1.5s. Movement and attacks build Energize. | An AD/crit first-hit item for trading, chasing, and repositioning. The speed is offensive and defensive; it rewards spaced, intermittent hits. | **Strong fit.** Caitlyn can safely land the charged first hit and use the speed to preserve range. Particularly coherent for lane pressure and one-hit-then-reposition patterns. |
| **Rapid Firecannon** — 2650g | 35% AS, 25% crit, 4% MS. At 100 Energize, the next attack deals 40 bonus magic damage and gains 35% bonus range, capped at +150. | Safe poke, siege, and one-hit access. It sacrifices AD for reach and attack cadence. | **Strong situational fit.** Caitlyn reaches the +150 cap, so a normal energized attack can be delivered from 800 range. Great when safety/access matters; weaker than an AD item if she is already free-hitting. |
| **The Collector** — 3000g | 50 AD, 10 lethality, 25% crit. Damage executes champions below 5% max health; champion kills grant 25 bonus gold. | Snowball/burst bridge against squishier targets. Lethality is strongest into low armor; the execute is a finisher, not an anti-tank substitute. | **Strong when ahead or facing squishies.** AD, crit, and lethality all support her physical attack/Q/R burst. Prefer an armor-penetration capstone when bonus armor/health is the real problem. |
| **Essence Reaver** — 3050g | 50 AD, 20 AH, 25% crit. Spellblade: after an ability, the next attack within 10s deals 125% base AD plus up to 50% base AD based on crit chance as bonus physical damage, restores mana equal to 50% of that proc, 1.5s cooldown. | Crit caster-marksman item: mana sustain, haste, and repeated ability-to-attack weaving. Only one Spellblade item can be owned. | **Good, pattern-dependent.** E and trap-triggered Headshots naturally lead into an attack; mana and haste support repeated Q/W/E use. It is less automatic than pure long-range/crit multipliers if the player does not reliably weave a proc after casts. |
| **Fiendhunter Bolts** — 2650g | 45% AS, 25% crit, 4% MS; 30 ultimate haste. After casting R, the next 3 attacks in 8s gain 50% AS and are forced crits at 80% normal crit damage. If an attack would already crit, it instead deals 15% bonus true damage. Opening Barrage has a 45s cooldown. | Ultimate-centric auto follow-up item. Best when a champion can safely cast R before or during a fight and immediately make three attacks. | **Situational.** Caitlyn appreciates more Ace in the Hole casts, but R is a channel that often happens before engagement or during cleanup. Buy only when the R-to-three-attacks sequence is practical; it is not a generic replacement for every Zeal item. |

### Sustained crit / attack-speed items

| Item | Exact live stats and effect | General use | Caitlyn read |
|---|---|---|---|
| **Phantom Dancer** — 2650g | 65% AS, 25% crit, 10% MS; permanently Ghosted (unit collision ignored). | Maximum sustained attack speed and kiting among the crit options. Best when there is enough uninterrupted attack uptime to exploit it. | **Good into front-to-back fights.** Excellent movement/attack feel and crit, but no AD means lower isolated Headshot/Q/R punch than an AD purchase. |
| **Navori Flickerblade** — 2650g | 40% AS, 25% crit, 4% MS. Attacks reduce remaining basic-ability cooldowns by 15%. | Repeated basic-spell access for marksmen whose attacks and basic abilities form a feedback loop. | **Playable but specialized.** More nets, traps, and Q casts can be valuable, but the item gives no AD and competes with direct Headshot/burst amplification. Prefer it only when repeated utility and mobility are actually deciding fights. |
| **Runaan's Hurricane** — 2650g | 40% AS, 25% crit, 4% MS. Ranged-only. Attacks fire at up to 2 additional enemies; each bolt deals 55% AD physical damage, applies on-hit effects, and can crit. | Multi-target DPS, waveclear, and on-hit spreading when enemies regularly stand in bolt angles. | **Niche.** It improves multi-target output, but Caitlyn's signature payoff is focused long-range Headshot damage and the extra bolts do not create the same trapped/netted Headshot payoff. Use for clustered front-to-back fights, not by default. |

### Armor, health, healing, and defensive answers

| Item | Exact live stats and effect | General use | Caitlyn read |
|---|---|---|---|
| **Lord Dominik's Regards** — 3300g | 35 AD, 35% armor penetration, 25% crit. Deal up to 15% increased damage to champions based on bonus health (1% per 100, capped at 1500 bonus health). Fatality-group item. | Premier crit answer to armor plus bonus-health stacking. | **Excellent anti-frontline item.** Maintains crit/Headshot scaling while solving both armor and high bonus health. Do not combine with another Fatality item. |
| **Mortal Reminder** — 3000g | 35 AD, 30% armor penetration, 25% crit. Physical damage applies 40% Grievous Wounds for 3s. Fatality-group item. | Choose over LDR when healing reduction is more important than 5% pen and Giant Slayer. | **Situational anti-heal.** Caitlyn applies it safely with physical damage, but it is a teamwide trade: if an ally reliably applies anti-heal, LDR often yields more personal damage. |
| **Bloodthirster** — 3400g | 80 AD, 15% lifesteal. Excess lifesteal healing becomes a persistent shield, scaling from 165 at low levels to 315 at level 18. | High raw AD, sustain, and pre-fight effective health. Best when the player can attack to heal and wants poke resistance without giving up AD. | **Strong late damage/sustain.** 80 AD is excellent for Caitlyn's attacks and physical abilities. It gives no crit, so fit it around—not instead of—the crit engine. |
| **Immortal Shieldbow** — 3000g | 55 AD, 25% crit. Damage that would put the holder below 30% health first grants a 400–700 shield by level for 3s (90s cooldown; ranged shield is 80% of those values). Lifeline-group item. | Anti-burst crit option when one damage sequence is killing the marksman before lifesteal or repositioning can matter. | **Strong defensive crit choice.** Preserves AD and Headshot crit scaling. Buy for burst survival, not as a general damage maximum. Cannot be combined with Maw because both are Lifeline. |
| **Guardian Angel** — 3200g | 55 AD, 45 armor. Lethal damage causes 4s resurrection stasis, then restores 50% base health and 100% max mana; 300s cooldown. It sells for only 40% while Rebirth is on cooldown. | Late-fight insurance against physical damage/dive when teammates can protect the resurrection location. | **Strong late situational item.** Caitlyn is valuable if she gets a second firing window, but GA is poor if the enemy can simply wait at the body. Evaluate the battlefield, not only the passive name. |
| **Maw of Malmortius** — 3100g | 60 AD, 15 AH, 40 MR. Magic damage that would put the holder below 30% grants a 200 +150% bonus-AD magic shield for 3s and 10% omnivamp until combat ends (90s cooldown; ranged shield is 150 +112.5% bonus AD). Lifeline-group item. | Anti-magic-burst item that keeps offensive AD. | **Situational versus fed AP burst.** Strong when magic damage is specifically killing Caitlyn. It gives no crit and cannot coexist with Shieldbow; do not buy it merely because the enemy has any AP champion. |
| **Mercurial Scimitar** — 3200g | 50 AD, 35 MR, 10% lifesteal. Active removes all crowd-control debuffs except Airborne, then grants 50% bonus total MS and Ghosted for 2s; 90s cooldown. Quicksilver-group item. | A targeted answer to fight-ending removable CC, with sustain and MR. | **High-value when one removable CC decides the game.** Caitlyn has range and E but no native cleanse. This is not an answer to knockups, and spending 3200g for a cleanse that is never needed is costly. |

### On-hit and hybrid alternatives

| Item | Exact live stats and effect | General use | Caitlyn read |
|---|---|---|---|
| **Kraken Slayer** — 3000g | 45 AD, 40% AS, 4% MS. Every third attack deals 150–200 bonus physical damage by level for melee / 120–160 for ranged, increased by up to 75% based on target missing health (262.5–350 melee / 210–280 ranged maximum). | Sustained single-target on-hit damage and cleanup; currently has no crit. | **Niche on Caitlyn.** Strong if she can repeatedly hit the same target, but it does not scale Headshot through crit. Use as part of a deliberate sustained/on-hit plan rather than assuming it is the universal ADC item. |
| **Blade of the Ruined King** — 3200g | 40 AD, 25% AS, 10% lifesteal. Attacks deal 6% target current-health bonus physical damage for ranged holders (9% melee), capped at 100 versus minions/monsters. Three attacks on a champion slow 30% for 1s; 15s cooldown. | Health-stacking target damage, sustain, and a three-hit stickiness tool. Current-health damage is best early in a target's health bar. | **Niche anti-health/on-hit choice.** Caitlyn can apply it safely, but gives up crit/Headshot scaling and has better crit-native anti-tank access through LDR. |
| **Guinsoo's Rageblade** — 3000g | 30 AD, 30 AP, 25% AS; attacks add 30 magic damage. Attacks grant 8% AS for 3s, up to 4 stacks (32%). At full stacks, every third attack triggers on-hit effects a second time. | Core on-hit amplifier when the build/champion supplies multiple valuable on-hit effects. | **Usually skip in standard Caitlyn.** She lacks a defining innate on-hit to duplicate and wants crit for Headshot. It only makes sense in a consciously constructed on-hit build. |
| **Terminus** — 3000g | 30 AD, 35% AS. Attacks deal 30 +10% bonus AD +10% AP bonus magic damage. Attacks on champions alternate: Light grants 6/7/8 armor and MR by level, Dark grants 10% armor and magic penetration; each stacks 3 times for 18–24 resists and 30% dual penetration. Fatality and Blight-group item. | Scaling on-hit capstone for mixed damage that can remain in combat long enough to build six alternating hits. | **Niche.** The full pen/resist payoff takes sustained attacks and gives no crit. Better for a true on-hit Caitlyn experiment than her usual long-range burst pattern. |
| **Wit's End** — 2800g | 50% AS, 45 MR, 20% tenacity. Attacks deal 45 bonus magic damage on-hit. | Sustained magic-damage and CC defense for on-hit attackers. Tenacity shortens many disables but not knockups or suppression. | **Niche defensive on-hit option.** Useful into sustained magic threats and reducible CC, but no AD/crit sharply lowers normal Caitlyn burst. |
| **Nashor's Tooth** — 2900g | 80 AP, 50% AS, 15 AH. Attacks deal 15 +15% AP bonus magic damage on-hit. | AP on-hit item for champions whose abilities and attacks both scale with AP. | **Usually skip.** The Marksman flag means shop discoverability, not Caitlyn suitability. Its stat budget does not support her crit/AD Headshot plan. |
| **Statikk Shiv** — 3000g | 45 AD, 45 AP, 30% AS, 4% MS. Basic attacks accelerate Energize. The energized attack chains for 60 magic damage (90 vs non-champions) through 4–8 targets by level and applies on-hit effects to secondary targets. | Hybrid waveclear and on-hit spreading, useful when shove and mixed damage matter. | **Niche waveclear/tempo option.** Caitlyn already has Q and long range for wave control; Shiv gives no crit and competes with stronger single-target/Headshot purchases. |
| **Manamune** — 2900g | 35 AD, 500 mana, 15 AH. Awe grants AD equal to 2% max mana. Manaflow adds 3 max mana per attack/ability trigger (6 vs champions), to 360, then transforms into Muramana. Muramana has 35 AD, 1000 mana, 15 AH; attacks vs champions deal 1.2% max-mana bonus physical damage and damaging abilities deal 3–4% max-mana bonus physical damage. | Delayed mana-scaling attack/ability item. Requires Tear and stacking; strongest on champions that repeatedly apply Shock with abilities. | **Niche poke/caster route.** Mana and ability damage are real, but the delayed transformation and lack of crit give up Caitlyn's most direct Headshot scaling. |

## Shared Marksman-flagged starters, basics, boots, and components

These records also contain the Marksman flag. They are not 26 additional “build identities”: most are shared construction pieces, defensive pivots, or starting choices. This table covers normal Summoner's Rift base records. Guardian's Blade and Guardian's Hammer also carry the flag in the client but are alternate-map starter items and are excluded here. The three jungle companions appear only for a Smite/jungle purchase context; they are not Caitlyn-bot recommendations.

| Item | Cost | Current visible effect | When it matters for Caitlyn |
|---|---:|---|---|
| Cloak of Agility | 600g | 15% crit | Flexible crit recall; directly supports Headshot scaling. |
| Ruby Crystal | 400g | 150 health | Shared component only; Caitlyn's completed Marksman items do not normally ask for it. |
| Cloth Armor | 300g | 15 armor | Defensive component for Steel Sigil/GA path. |
| Null-Magic Mantle | 400g | 20 MR | Defensive component for QSS/Maw/Wit's paths. |
| Long Sword | 350g | 10 AD | Efficient small AD recall and common recipe piece. |
| Pickaxe | 875g | 25 AD | Mid-sized AD spike; frequent crit-item component. |
| B. F. Sword | 1300g | 40 AD | Large raw-AD recall for IE, Yun Tal, Stormrazor, Bloodthirster, or GA. |
| Dagger | 250g | 10% AS | Small attack-speed recall; builds Zeal/Recurve/Hearthbound paths. |
| Glowing Mote | 250g | 5 AH | Shared haste component; appears in Warhammer and Sheen paths. |
| Doran's Shield | 450g | 110 health; 4 health per 5s; restores health after champion damage; attacks deal +5 physical to minions | Defensive lane start into difficult poke/attrition; sacrifices the offensive stats of Blade/Bow. |
| Doran's Blade | 450g | 10 AD, 80 health, 2.5% omnivamp | Balanced default when health plus AD and broad sustain matter. |
| Cull | 450g | 7 AD; attacks heal 3; first 100 minion kills give +1g each and completion gives +350g | Greedy scaling buy when Caitlyn can farm safely and does not need immediate combat power. |
| Doran's Bow | 400g | 8 AD, 15% AS, 1.5% omnivamp | Attack-speed-oriented lane start; favors repeated autos over Blade's extra health/AD. |
| Tear of the Goddess | 400g | 240 mana; ability triggers stack to +360 mana; +5 physical damage to minions | Only for a planned Manamune route; otherwise delays Caitlyn's combat stats. |
| Scorchclaw Pup | 450g | Jungle companion; eventual periodic burn/slow | Smite/jungle-only context, not standard bot Caitlyn. |
| Gustwalker Hatchling | 450g | Jungle companion; eventual brush/monster movement speed | Smite/jungle-only context. |
| Mosstomper Seedling | 450g | Jungle companion; eventual out-of-combat shield | Smite/jungle-only context. |
| Recurve Bow | 700g | 15% AS; attacks +15 physical on-hit | On-hit recipe spike. |
| Vampiric Scepter | 900g | 15 AD, 7% lifesteal | Lane sustain bridge toward BORK, Bloodthirster, or Mercurial. |
| Steel Sigil | 1100g | 15 AD, 30 armor | Efficient physical-defense bridge to GA. |
| Berserker's Greaves | 1100g | 25% AS, 45 MS | Standard offensive boot when attack cadence matters. Boots remain a separate shop/slot decision. |
| Boots of Swiftness | 1000g | 55 MS; slows are 25% less effective | Kiting/slow-resistance alternative when movement is more valuable than Berserker AS. |
| Last Whisper | 1450g | 20 AD, 18% armor penetration | Early armor answer; builds LDR/Mortal. |
| Hearthbound Axe | 1200g | 20 AD, 20% AS | Clean sustained-DPS component for Kraken/Terminus. |
| Sheen | 900g | 10 AH; post-ability next attack gains bonus physical on-hit | Essence Reaver bridge; value depends on weaving the attack. |
| Zeal | 1200g | 15% AS, 15% crit, 4% MS | Efficient movement/AS/crit bridge to the Zeal family. |
| Executioner's Calling | 800g | 15 AD; physical damage applies 40% Grievous Wounds for 3s | Buy early only when healing reduction cannot wait for Mortal Reminder. |
| Caulfield's Warhammer | 1050g | 20 AD, 10 AH | Ability/AD bridge toward Essence Reaver, Manamune, or Maw. |
| Serrated Dirk | 1000g | 20 AD, 10 lethality | Strong low-armor burst component for Collector. |
| Quicksilver Sash | 1300g | 30 MR; active removes all CC except Airborne | Buy before full Mercurial when one removable disable already decides fights. |
| Scout's Slingshot | 600g | 20% AS; damaging a champion deals bonus magic damage, attacks reduce its cooldown | Cheap attack-speed/proc bridge for Yun Tal and Zeal-family items. |
| Hexdrinker | 1300g | 25 AD, 25 MR; magic damage that would drop below 30% grants a 2.5s magic shield | Early anti-magic-burst stopgap on the Maw route. |
| Noonquiver | 1300g | 15 AD, 20% crit | Efficient crit bridge to Shieldbow, LDR, or Hexoptics. |
| Rectrix | 775g | 15 AD, 4% MS | Mobility/AD bridge into Kraken. |

## Decision guide for Caitlyn

Use this as a game-state guide, not a mandatory order:

- **Need maximum crit/Headshot scaling:** Infinity Edge, then crit items appropriate to the targets.
- **Can exploit range and want first-hit power:** Hexoptics C44, Stormrazor, Rapid Firecannon.
- **Need to kill armor + bonus-health frontline:** Lord Dominik's Regards.
- **Need healing reduction personally:** Mortal Reminder instead of LDR.
- **Ahead into low-armor carries:** The Collector.
- **Need sustain against poke:** Bloodthirster; consider Vampiric Scepter timing.
- **Need to survive burst while keeping crit:** Immortal Shieldbow.
- **Need a cleanse:** Quicksilver Sash first, then Mercurial Scimitar when completion is affordable.
- **Need anti-magic Lifeline:** Maw; remember it excludes Shieldbow.
- **Need late resurrection against physical dive:** Guardian Angel, only when the revive location is defensible.
- **Expect long, uninterrupted front-to-back attacking:** Phantom Dancer; Navori only if repeated basic-ability access is the payoff.
- **Building on-hit intentionally:** Kraken/BORK into an on-hit capstone such as Guinsoo or Terminus; this is a different Caitlyn build identity, not a casual one-item detour.

## Important constraints and data-quality notes

- **Fatality-group exclusivity:** Lord Dominik's Regards, Mortal Reminder, and Terminus are alternatives, not stackable purchases.
- **Lifeline-group exclusivity:** Immortal Shieldbow and Maw of Malmortius cannot be owned together.
- **Quicksilver-group exclusivity:** one QSS-derived completed item.
- **Runaan's Hurricane:** ranged champions only.
- Data Dragon's normalized descriptions intentionally omit some calculated scalars (for example, shield amounts and several on-hit formulas). Exact values above were cross-checked against the patch-pinned client item calculations/string-backed records rather than invented from the shortened public tooltip.
- The `/latest/` CommunityDragon path is mutable and was not used for the inventory. All client evidence is pinned to `/16.15/`.
- Riot changed **Terminus** and **Yun Tal Wildarrows** in the live [26.15 patch notes](https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-15-notes/#patch-items): Terminus gained bonus-AD/AP scaling on Shadow; Yun Tal gained 5% AS and a cheaper combine cost. Those values are reflected here.
