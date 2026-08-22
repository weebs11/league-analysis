# Jhin and the Marksman item shop — patch 26.15

Research date: 2026-08-02  
Live Riot patch: **26.15**  
Data Dragon build: **16.15.1**

## Executive summary

Jhin does not evaluate Marksman items like a conventional attack-speed carry. His gun fires at a fixed rate, but attack speed is not wasted: **each 1% bonus attack speed contributes 0.3% to Whisper's total-AD multiplier**, and it also increases the move-speed burst he receives after a critical strike. Likewise, each 1% critical-strike chance contributes 0.35% to that total-AD multiplier. A finished 25%-crit item therefore adds **8.75 percentage points** to the multiplier before considering the item's other stats; 45% attack speed adds **13.5 points**. These are percentage points in Jhin's passive total-AD multiplier, not flat AD.

That makes the strongest standard Jhin items those that combine some mix of raw AD, crit, range/access, armor penetration, and movement: **Infinity Edge, The Collector, Yun Tal Wildarrows, Stormrazor, Rapid Firecannon, Hexoptics C44, Lord Dominik's Regards**, plus the right defensive answer. Pure attack-speed items can still add substantial displayed AD and crit mobility, but Jhin cannot use their intended “more attacks per second” payoff and must reload after four shots.

This is a mechanics and decision report, not a live pick-rate or win-rate report. The 26-item inventory and exact item effects come from the existing [patch 26.15 Marksman-item research](marksman-items-26-15.md). The Jhin ratings below are an editorial read of those effects against Riot's current Jhin data.

## Sources and confidence

- Riot's [patch 26.15 notes](https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-15-notes/) establish the live gameplay patch and its Yun Tal/Terminus changes.
- Riot's [Data Dragon 16.15.1 Jhin JSON](https://ddragon.leagueoflegends.com/cdn/16.15.1/data/en_US/champion/Jhin.json) establishes the public-facing passive: fixed fire rate, four shots, guaranteed fourth-shot crit/execute, and move speed after critting. Riot's [item JSON](https://ddragon.leagueoflegends.com/cdn/16.15.1/data/en_US/item.json) establishes public item names, costs, stats, and shortened descriptions.
- Riot's [25.06 notes](https://www.leagueoflegends.com/en-us/news/game-updates/patch-25-06-notes/) establish the current 0.35 crit and 0.30 bonus-AS conversion coefficients; its [25.23 notes](https://www.leagueoflegends.com/en-us/news/game-updates/patch-25-23-notes/) establish the current 0.44 crit-movement coefficient. Riot's [26.1 notes](https://www.leagueoflegends.com/en-us/news/game-updates/patch-26-1-notes/) establish Jhin's current 75% multiplicative crit-damage modifier after League's base crit damage moved to 200%.
- The patch-pinned CommunityDragon [Jhin champion record](https://raw.communitydragon.org/16.15/game/data/characters/jhin/jhin.bin.json) and [item records](https://raw.communitydragon.org/16.15/game/items.cdtb.bin.json) are extracted mirrors of Riot's shipped client assets. They expose the client tooltip formulas and item scalars that Data Dragon abbreviates. CommunityDragon itself is not a Riot service.
- Riot's [26.1 item introduction](https://www.leagueoflegends.com/en-us/news/game-updates/patch-26-1-notes/) explains Fiendhunter Bolts' intended post-ultimate use; Riot's [26.2 notes](https://www.leagueoflegends.com/en-us/news/game-updates/patch-26-2-notes/) establish the buff to its current 80% forced-crit and 15% true-damage values.

The exact result of undocumented script-level combinations—most notably when Fiendhunter Bolts' eight-second window starts relative to a fully played Curtain Call—is not provable from static client records alone. Those cases are labeled as such instead of asserted as settled.

## Jhin baseline for reading every item

Riot's shipped passive record provides the following Summoner's Rift values:

- **550 attack range**, **0.625 fixed base attack speed**, four shots, and a **2.5-second reload**.
- The fourth attack always critically strikes and deals an additional **15% / 20% / 25% of the target's missing health** at levels 1 / 6 / 11.
- Ordinary Jhin crits deal **75% of the normal crit calculation** (25% less), but every crit grants move speed for **2 seconds**. With patch 26.1's 200% base crit, that is 150% attack damage before other modifiers; with Infinity Edge's +30 crit damage it becomes 172.5% (75% of 230%).
- The crit move-speed bonus is **14% + 0.44 × bonus attack speed**. For example, 45% bonus AS adds 19.8 percentage points, producing a 33.8% crit-triggered burst before other modifiers.
- Whisper increases Jhin's total attack damage by a level-based **4%–44%**, plus **0.35 × crit chance**, plus **0.30 × bonus attack speed**. At 25% crit and 45% bonus AS, the item stats contribute 8.75 + 13.5 = **22.25 percentage points** to this multiplier.
- The client tooltip explicitly says attack damage scales with crit chance and bonus attack speed, and move speed scales with bonus attack speed. Temporary attack-speed buffs can therefore become temporary AD and larger crit-speed windows; they do not make Jhin fire faster.
- Jhin's Q, W, E, and R all have attack-damage ratios. Raw AD and the passive's total-AD amplification improve more than his basic attacks, while on-hit effects generally only help the four-round attack pattern.

Practical consequence: evaluate AS through **converted AD + crit mobility**, not conventional sustained DPS. Evaluate crit through **actual crits + guaranteed fourth-shot value + converted AD**. Jhin still wants opportunities to spend four deliberate shots rather than stand still and machine-gun a target.

## Completed item reference

Fit labels mean:

- **Excellent/core** — naturally reinforces Jhin's standard damage pattern.
- **Strong situational** — excellent when its stated game condition exists.
- **Niche/alternative** — mechanically functional, but asks Jhin to play away from his main strengths or gives up a better default.
- **Usually skip** — most of the item's intended payoff conflicts with fixed cadence, reload, or Jhin's damage pattern.

### Crit, range, and burst

| Item | What it does | General use | Jhin read |
|---|---|---|---|
| **Infinity Edge** — 3500g | 75 AD, 25% crit, +30% crit damage. | Crit capstone for attacks and crit-scaling effects. Improves as the rest of the build supplies crit. | **Excellent/core.** Raw AD feeds every physical ratio, 25% crit adds 8.75 points to Whisper's AD multiplier, and the 75% modifier makes Jhin's basic crits 172.5% instead of 150% attack damage. It amplifies both random and guaranteed attack crits, including the crit portion of fourth shot; it does not multiply fourth shot's separate missing-health damage. It is an expensive pure-damage spike, so a survival or penetration need can delay it. |
| **Yun Tal Wildarrows** — 3000g | 50 AD, 45% AS, begins at 0% crit; ranged attacks add 0.2% permanent crit up to 25% (125 attacks). Champion attack grants 30% AS for 6s; attacks reduce its 30s cooldown, crits reduce it twice as fast. | Scaling first-item path for a champion who can stack attacks and repeatedly cycle Flurry. | **Strong scaling, slow ramp.** The permanent 45% AS adds 13.5 points to Whisper's AD multiplier and Flurry's 30% adds another temporary 9. Once stacked, the crit adds 8.75 more. But Jhin's fixed cadence and reload make 125 attacks and cooldown cycling slower than on conventional high-AS users. Do not price it as a 25%-crit item on completion. |
| **Hexoptics C44** — 2800g | 55 AD, 25% crit; attacks deal up to 10% more damage by distance, capped at 500 units; a recent takedown grants 100 attack range for 8s. | Long-range first-hit damage and cleanup access. | **Excellent/core candidate.** Jhin's 550 range can reach the full distance amp, and a takedown takes normal attacks to 650 range. Raw AD, crit conversion, a large deliberate hit, and cleanup range all match his pattern. |
| **Stormrazor** — 3200g | 50 AD, 20% AS, 25% crit; an Energized attack deals 100 magic damage and grants 45% bonus move speed for 1.5s. | Trade once, reposition, and re-enter. | **Excellent/core candidate.** Its permanent AS contributes 6 points to Whisper's AD multiplier rather than fire rate, while its crit contributes 8.75. The Energized speed layers naturally with Jhin's crit-speed burst and helps him leave after a heavy shot. |
| **Rapid Firecannon** — 2650g | 35% AS, 25% crit, 4% MS; Energized attack deals 40 magic damage and gains 35% attack range, capped at +150. | Safe poke, target access, siege, and one-hit spacing. | **Excellent situational access item.** Jhin reaches the +150 cap, so an Energized normal attack reaches **700 range**. The 35% AS contributes 10.5 points to Whisper's AD multiplier and 15.4 points to the crit-speed formula; crit adds another 8.75 AD-multiplier points. It has no raw AD, so buy it because delivering a shot safely is the problem. |
| **The Collector** — 3000g | 50 AD, 10 lethality, 25% crit; executes champions below 5% health and gives 25 bonus gold on champion kills. | Burst/snowball bridge into low-armor teams. | **Excellent into squishies or while ahead.** Every stat matches Jhin; lethality supports Q/W/R and attacks, while the execute complements fourth shot and Curtain Call's missing-health cleanup. It is not a substitute for percentage penetration into armor/health stackers. |
| **Essence Reaver** — 3050g | 50 AD, 20 haste, 25% crit; after an ability, the next attack deals crit-scaling Spellblade damage and restores mana. | Ability-to-attack weaving, haste, and mana sustain. | **Strong but pattern-dependent.** Jhin frequently weaves Q or E around an attack and appreciates raw AD/crit/haste. His fixed cadence does not prevent a 1.5s Spellblade proc, but he cannot exploit repeated procs as rapidly as a fast attacker; buy it when ability uptime and deliberate weave damage matter. |
| **Fiendhunter Bolts** — 2650g | 45% AS, 25% crit, 4% MS, 30 ultimate haste. After R, the next three attacks within 8s gain 50% AS and are forced crits at 80% normal crit damage; an attack that would already crit instead deals normal crit damage plus 15% bonus true damage. 45s cooldown. | Concentrated auto-attack power immediately after an ultimate. Riot named Twitch, Zeri, and Yunara as representative intended users. | **Niche/experimental on Jhin despite tempting text.** Permanent AS contributes 13.5 points to Whisper's AD multiplier and the temporary 50% contributes 15 more; the latter also takes his crit-speed burst from 33.8% to 55.8% before the item's persistent 4% MS. A forced, otherwise non-crit Jhin attack should deal 80% of his normal crit—120% attack damage without IE or 138% with IE—while activating crit movement. His guaranteed fourth attack should take the natural-crit/true-damage branch in principle, but the static data does not explicitly document that champion script interaction. More importantly, Curtain Call is a channel of up to four recasts, so its sequencing conflicts with an eight-second *post-cast* basic-attack window. Ultimate haste is valuable; do not call the full item a Jhin core without an on-patch live test of when the window begins/ends. |

### Sustained crit and Zeal alternatives

| Item | What it does | General use | Jhin read |
|---|---|---|---|
| **Phantom Dancer** — 2650g | 65% AS, 25% crit, 10% MS; permanently Ghosted. | Maximum attack cadence and kiting among crit options. | **Strong mobility, nonstandard damage item.** Jhin cannot use 65% AS to fire faster, but it adds 19.5 points to Whisper's total-AD multiplier and 28.6 points to his crit-speed formula; crit adds another 8.75 AD-multiplier points. This can scale hard after other raw-AD items, but the item gives no flat AD and loses much of the conventional sustained-DPS purpose. |
| **Navori Flickerblade** — 2650g | 40% AS, 25% crit, 4% MS; attacks reduce remaining basic-ability cooldowns by 15%. | Attack/basic-ability feedback loop. | **Niche.** The stats still convert into 12 + 8.75 points of Whisper AD multiplier, but four shots plus reload limit Transcendence proc frequency. Consider only when more W/E/Q access is worth more than first-hit range, raw AD, or mobility. |
| **Runaan's Hurricane** — 2650g | 40% AS, 25% crit, 4% MS; ranged attacks fire two 55%-AD bolts that apply on-hit effects and can crit. | Multi-target DPS, on-hit spreading, and waveclear. | **Usually skip.** Converted AS and crit are real, but Jhin still fires only four times before reloading. The bolts do not reproduce his fourth-shot missing-health execute; they mainly add multi-target attack damage to a champion whose stronger identity is focused, deliberate shots. |

### Armor, sustain, and defensive answers

| Item | What it does | General use | Jhin read |
|---|---|---|---|
| **Lord Dominik's Regards** — 3300g | 35 AD, 35% armor penetration, 25% crit; up to 15% increased champion damage based on bonus-health difference. Fatality group. | Crit answer to armor plus bonus-health stacking. | **Excellent anti-frontline item.** Keeps crit conversion and raw AD while making all physical parts of Jhin's kit relevant into armor. Giant Slayer matches targets his fourth-shot execute alone cannot solve from high health. |
| **Mortal Reminder** — 3000g | 35 AD, 30% armor penetration, 25% crit; physical damage applies 40% Grievous Wounds. Fatality group. | Personal anti-heal when someone must apply it reliably. | **Strong situational.** Jhin can apply Wounds from range with physical damage, but loses 5% penetration and LDR's health amp. Prefer LDR when an ally already supplies reliable anti-heal. |
| **Bloodthirster** — 3400g | 80 AD, 15% lifesteal; excess lifesteal becomes a persistent 165–315 shield by level. | Maximum raw AD, sustain, and poke resistance. | **Excellent late situational.** Jhin's passive multiplies the 80 AD, and the result improves attacks plus Q/W/R. Lifesteal is constrained by his fixed cadence but each large attack heals heavily. It supplies no crit, so fit it around the crit engine rather than replacing that engine. |
| **Immortal Shieldbow** — 3000g | 55 AD, 25% crit; damage that would cross 30% health first grants a level-scaling shield for 3s (80% ranged value), 90s cooldown. Lifeline group. | Anti-burst crit option. | **Strong defensive crit choice.** It keeps both raw AD and the 8.75-point crit conversion while buying one more firing window. Buy when burst prevents Jhin from using his damage, not for maximum output. Mutually exclusive with Maw. |
| **Guardian Angel** — 3200g | 55 AD, 45 armor; lethal damage triggers 4s stasis and resurrection at 50% base health and 100% max mana, 300s cooldown. | Late physical-defense insurance when allies can protect the body. | **Strong late situational.** Raw AD remains efficient, but the revive only matters if Jhin can safely re-enter and reload/reposition. Poor when the enemy can camp the body. |
| **Maw of Malmortius** — 3100g | 60 AD, 15 haste, 40 MR; magic damage crossing 30% health grants a ranged magic shield of 150 +112.5% bonus AD, plus 10% omnivamp until combat ends. Lifeline group. | Anti-magic-burst offense/defense. | **Especially strong into fed AP burst.** Jhin's unusually high bonus AD can make Maw's bonus-AD shield scaling more valuable than it appears, while 60 AD and haste preserve threat. It has no crit and excludes Shieldbow; buy for a specific magic kill pattern. |
| **Mercurial Scimitar** — 3200g | 50 AD, 35 MR, 10% lifesteal; active removes all CC except Airborne and grants 50% bonus total MS plus Ghosted for 2s. | Targeted answer to fight-ending removable CC. | **Strong situational.** Jhin has no native cleanse, and the active speed helps him reset spacing after escaping. Excellent if one removable disable determines fights; inefficient if it is never needed. |

### On-hit and hybrid alternatives

| Item | What it does | General use | Jhin read |
|---|---|---|---|
| **Kraken Slayer** — 3000g | 45 AD, 40% AS, 4% MS; every third attack deals 120–160 ranged bonus physical damage by level, up to 75% more based on missing health. | Sustained single-target on-hit and cleanup. | **Niche.** The 40% AS converts to 12 points of Whisper AD multiplier and the third-hit proc fits inside each four-shot magazine. But it provides no crit, cannot increase cadence, and asks Jhin to stay on one target. Use only in a deliberate on-hit/sustained route. |
| **Blade of the Ruined King** — 3200g | 40 AD, 25% AS, 10% lifesteal; ranged attacks deal 6% current-health physical damage; three champion attacks slow 30% for 1s. | Current-health damage, sustain, and three-hit stickiness. | **Niche anti-health option.** Jhin can reach the three-hit slow before reloading and AS adds 7.5 points to his AD multiplier, but fixed cadence makes repeated on-hit use slow and no crit weakens his main engine. LDR is usually the cleaner anti-frontline fit. |
| **Guinsoo's Rageblade** — 3000g | 30 AD, 30 AP, 25% AS; attacks add 30 magic on-hit, attacks stack up to 32% more AS, and at full stacks every third attack repeats on-hit effects. | On-hit amplifier for champions with valuable innate and item on-hits. | **Usually skip.** Its permanent AS adds 7.5 points to Whisper's AD multiplier and full Seething Strike can add 9.6 more, but Jhin must spend four slow shots to reach full stacks and then reload. He lacks a defining innate on-hit to duplicate; AP helps Q/E somewhat but does not rescue the mismatch. |
| **Terminus** — 3000g | 30 AD, 35% AS; attacks add mixed on-hit damage and alternate Light resist stacks with Dark dual-penetration stacks, reaching full value after six champion hits. Fatality/Blight group. | Long-fight mixed on-hit capstone. | **Usually skip.** Jhin must cross a reload to reach six attacks, so full defenses and 30% dual penetration arrive late. The 35% AS converts to 10.5 points of AD multiplier, but no crit and slow stack access make LDR or Mortal the more coherent penetration choices. |
| **Wit's End** — 2800g | 50% AS, 45 MR, 20% tenacity; attacks deal 45 bonus magic damage on-hit. | Magic/CC defense for sustained on-hit attackers. | **Niche defensive option.** The AS is not dead—it adds 15 points to Whisper's AD multiplier and enlarges crit-speed windows—but Jhin applies the on-hit only four times per magazine and gets no raw AD or crit. Buy only when MR plus reducible-CC defense is the actual need. |
| **Nashor's Tooth** — 2900g | 80 AP, 50% AS, 15 haste; attacks deal 15 +15% AP magic damage on-hit. | AP on-hit for champions who scale both spells and attacks with AP. | **Usually skip outside a hybrid experiment.** AP does feed Dancing Grenade and Lotus Trap, and 50% AS adds 15 points to Whisper's AD multiplier, but the item gives no raw AD/crit and Jhin cannot exploit the on-hit cadence. |
| **Statikk Shiv** — 3000g | 45 AD, 45 AP, 30% AS, 4% MS; Energized attack chains 60 magic damage (90 to non-champions) and applies on-hits to secondary targets; basic attacks accelerate Energize. | Hybrid waveclear and on-hit spreading. | **Niche tempo/waveclear item.** Jhin can use AD, AP, converted AS, and movement, so the stat line is less wasteful than it looks. Still, fixed cadence charges it slowly through attacks, he already has Q for wave manipulation, and it supplies no crit. |
| **Manamune** — 2900g | 35 AD, 500 mana, 15 haste; grants AD equal to 2% max mana and stacks to Muramana, whose attacks and damaging abilities add max-mana physical damage. | Delayed mana-scaling attack/caster route. | **Niche caster/poke route.** Raw/scaling AD, mana, and haste support repeated Q/W/E/R, but delayed transformation and no crit give up Jhin's cleaner attack scaling and early pressure. Treat it as a planned build identity, not a casual Tear detour. |

## Starters and boots

| Item | Current effect | Jhin read |
|---|---|---|
| **Doran's Blade** — 450g | 10 AD, 80 health, 2.5% omnivamp. | **Balanced default.** Raw AD is multiplied by Whisper; health and broader sustain are valuable in real trades. |
| **Doran's Bow** — 400g | 8 AD, 15% AS, 1.5% omnivamp. | **Real offensive alternative, not wasted AS.** At level 1 the 15% AS adds 4.5 points to Whisper's total-AD multiplier, so Bow can yield slightly more displayed AD than Blade despite showing 2 less raw AD. Choose it for cheaper offensive efficiency and crit-mobility scaling; Blade buys 80 health and stronger sustain. It still does not make Jhin shoot faster. |
| **Cull** — 450g | 7 AD; attacks heal 3; 100 minion kills grant 100 incremental gold plus a 350g completion reward. | **Greedy farm option.** Jhin's large, slow attacks make the flat on-hit heal modest but usable. Buy only when immediate lane health/combat stats are unnecessary. |
| **Doran's Shield** — 450g | 110 health, regen, extra recovery after champion damage, +5 attack damage to minions. | **Defensive lane start.** Correct into severe poke/attrition; concedes Jhin's stronger AD pressure. |
| **Berserker's Greaves** — 1100g | 25% AS, 45 MS. | **Damage boots, not cadence boots.** The AS adds 7.5 points to Whisper's total-AD multiplier and 11 points to the crit-speed formula. They do not increase his attack rate, so compare that converted damage against Swifties' better movement. |
| **Boots of Swiftness** — 1000g | 55 MS and 25% slow resistance. | **Excellent default mobility.** More reliable spacing, roams, and escape during reload; especially useful into slows. Unlike Berserker's, contributes no damage. |
| **Plated Steelcaps** — 1200g | 25 armor, 45 MS; reduces incoming attack damage by 10%. | **Physical/attack defense.** Buy when surviving a fed attack-based threat creates more shots than offensive boots would. |
| **Mercury's Treads** — 1250g | 20 MR, 45 MS, 30% tenacity. | **Magic/CC defense.** Buy for meaningful reducible crowd control or magic threat, not merely because the enemy team has AP damage. Tenacity does not solve every displacement/suppression. |

## Practical Jhin decision guide

- **Raw first-hit/crit scaling:** Infinity Edge plus raw-AD crit items.
- **Snowball or kill low-armor carries:** The Collector.
- **Long-range deliberate hits and takedown access:** Hexoptics C44.
- **One hit, then reposition:** Stormrazor.
- **Safely deliver a fourth shot or siege hit:** Rapid Firecannon; normal Energized range becomes 700.
- **Scale through a long, safe farm window:** Yun Tal, remembering the 125 ranged attacks required for 25% crit.
- **Armor + bonus-health frontline:** Lord Dominik's Regards.
- **Personal anti-heal is mandatory:** Mortal Reminder instead of LDR.
- **Poke sustain/raw AD:** Bloodthirster.
- **Burst survival while retaining crit:** Immortal Shieldbow.
- **Specific AP burst:** Maw; Jhin's bonus AD improves its shield.
- **Specific removable CC:** QSS into Mercurial.
- **Late physical dive insurance:** Guardian Angel only when the revive location is defensible.
- **Default boots:** Swiftness for reliable movement; Berserker's only when converted AD and stronger crit-speed bursts are worth more than Swifties' movement/slow resistance.
- **Fiendhunter Bolts:** treat as experimental until its post-Curtain Call timing is verified live on patch 26.15. Static data proves the stats and eight-second condition, not the exact activation timing across Jhin's channel/recasts.

## Item-system constraints

- **Fatality:** Lord Dominik's Regards, Mortal Reminder, and Terminus are mutually exclusive choices.
- **Lifeline:** Immortal Shieldbow and Maw of Malmortius cannot be combined.
- **Quicksilver:** only one QSS-derived completed item.
- **Runaan's Hurricane:** ranged-only, which Jhin satisfies; that does not make it a strong fit.
- Temporary attack-speed effects are included in Jhin's passive formulas, but static data cannot guarantee every item/champion script interaction. Where a recommendation depends on such an edge case, verify in the current Practice Tool before presenting it as settled.
