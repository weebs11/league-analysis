FIT_LABELS.excellent = "Excellent on Jhin";
FIT_LABELS.strong = "Strong on Jhin";

const jhinReads = {
  "Doran’s Bow": {
    fit: "strong",
    note: "A sharp offensive start. Jhin cannot fire faster, but bonus attack speed feeds Whisper’s AD conversion; take Bow only when giving up Blade’s 80 health will not get you punished.",
  },
  "Doran’s Blade": {
    fit: "excellent",
    note: "The dependable default. Jhin wants every shot to carry weight, and Blade supplies direct AD while its health and omnivamp make his vulnerable reload windows safer.",
  },
  "Cull": {
    fit: "situational",
    note: "A farm-lane investment. Jhin last-hits comfortably, but weak immediate combat stats reduce the threat of his fourth-shot windows; buy only when the lane cannot force you off the payout.",
  },
  "Hexoptics C44": {
    fit: "excellent",
    note: "A natural fit. Jhin’s 550 range clears Magnification’s 500-range ceiling, and the takedown extension gives him 650 range for eight seconds to choreograph the cleanup.",
  },
  "Yun Tal Wildarrows": {
    fit: "strong",
    note: "A real scaling path. Its attack speed—including Flurry—becomes AD, but Jhin’s fixed cadence makes the 125 attacks needed for 25% crit slower than on conventional carries. Respect the weak 0%-crit purchase moment.",
  },
  "Stormrazor": {
    fit: "excellent",
    note: "One of Jhin’s cleanest packages: AD, crit, attack speed that Whisper converts into AD, and an Energized speed burst that compounds his crit movement for hit-and-run spacing.",
  },
  "Essence Reaver": {
    fit: "niche",
    note: "Jhin can weave a shot after Q, W, or E and appreciates mana, but his measured firing rhythm produces fewer Spellblade procs than dedicated users. Buy for spell-weaving—not just because it has crit.",
  },
  "The Collector": {
    fit: "excellent",
    note: "Excellent into low-armor teams and while snowballing. AD, lethality, and crit all amplify Jhin’s pick-and-execute pattern, but the 5% execute is not a replacement for LDR into tanks.",
  },
  "Fiendhunter Bolts": {
    fit: "situational",
    note: "Experimental and sequence-dependent. Curtain Call is a channel, while Opening Barrage promises three attacks inside an eight-second post-R window; static data does not prove the exact timing across all four shots. The temporary attack speed does become AD.",
  },
  "Infinity Edge": {
    fit: "excellent",
    note: "Jhin’s defining damage multiplier. The fourth shot is guaranteed to crit, so IE has a scheduled payoff every magazine instead of relying entirely on random crit chance.",
  },
  "Immortal Shieldbow": {
    fit: "strong",
    note: "The clean anti-burst choice when a diver reaches him during a reload. It preserves AD and crit, though it cannot replace the positioning Jhin needs to keep his firing rhythm intact.",
  },
  "Phantom Dancer": {
    fit: "situational",
    note: "Its attack speed becomes AD and strengthens Jhin’s post-crit movement burst; 10% move speed is valuable for spacing. Still, the item gives no direct AD and does not make him fire faster.",
  },
  "Rapid Firecannon": {
    fit: "excellent",
    note: "Premier access and siege. Jhin reaches the +150 range cap for a 700-range Energized shot, letting him spend a fourth bullet or begin a pick without entering normal retaliation range.",
  },
  "Runaan’s Hurricane": {
    fit: "niche",
    note: "Usually skip. The bolts add multi-target output, but Jhin’s power lives in one carefully chosen target and a four-shot magazine; he lacks the repeated innate on-hits Hurricane wants to spread.",
  },
  "Navori Flickerblade": {
    fit: "niche",
    note: "Playable only for a deliberate utility loop. Four slow shots followed by reload provide fewer cooldown-reduction triggers than rapid-fire marksmen, while the item gives no direct AD.",
  },
  "Bloodthirster": {
    fit: "excellent",
    note: "Eighty direct AD makes every shot and spell heavier, while lifesteal and the overheal shield let Jhin approach a fight protected. Best after the crit engine is already established.",
  },
  "Kraken Slayer": {
    fit: "niche",
    note: "Poor match for a fixed-rate four-shot magazine. Jhin procs the third hit slowly, then reloads; the item has no crit and its large attack-speed budget cannot create extra attacks.",
  },
  "Statikk Shiv": {
    fit: "niche",
    note: "The attack speed converts into AD and the chain improves waveclear, but 45 AP is inefficient and Jhin already handles waves with Q. Stormrazor offers a cleaner Energized identity.",
  },
  "Blade of the Ruined King": {
    fit: "niche",
    note: "Usually skip. Its three-hit trigger and current-health on-hit damage want rapid repetition; Jhin applies both slowly and sacrifices the crit scaling that empowers Whisper.",
  },
  "Guinsoo’s Rageblade": {
    fit: "niche",
    note: "A poor standard fit. Jhin cannot exploit the ramping attack cadence, owns no defining every-hit effect to duplicate, and trades away the crit-centered fourth-shot build for an on-hit engine.",
  },
  "Terminus": {
    fit: "niche",
    note: "Six alternating champion attacks are a long setup for Jhin—more than a full magazine. LDR gives immediate penetration, crit, and a bonus-health multiplier without asking him to ramp through a reload.",
  },
  "Wit’s End": {
    fit: "niche",
    note: "Emergency magic-defense only. Its attack speed does feed Whisper’s AD conversion, but the on-hit damage is applied too slowly and the missing crit/direct AD is costly.",
  },
  "Nashor’s Tooth": {
    fit: "niche",
    note: "Skip in an AD Jhin build. The Marksman shop flag is not a recommendation for every marksman; an AP on-hit item does not advance his fourth-shot or physical burst plan.",
  },
  "Lord Dominik’s Regards": {
    fit: "excellent",
    note: "Jhin’s best answer when armor and bonus health blunt each individual shot. It keeps crit scaling intact and makes his limited magazine matter against the frontline he cannot attack around.",
  },
  "Mortal Reminder": {
    fit: "strong",
    note: "The anti-heal alternative to LDR. Jhin applies Wounds safely with attacks and physical spells, but give up Giant Slayer only when enemy healing is truly deciding fights.",
  },
  "Mercurial Scimitar": {
    fit: "strong",
    note: "High-value when one removable disable ruins the performance. The cleanse and speed can restore spacing, while AD and lifesteal remain useful; it does not remove knockups.",
  },
  "Guardian Angel": {
    fit: "strong",
    note: "Late objective insurance against physical dive. It is best when teammates can protect the resurrection location; otherwise Jhin simply returns beside enemies with another reload-sized vulnerability.",
  },
  "Maw of Malmortius": {
    fit: "strong",
    note: "A strong anti-magic-burst pivot because 60 AD remains fully useful. Choose it only when magic damage is the lethal constraint, and remember Lifeline prevents pairing it with Shieldbow.",
  },
  "Manamune → Muramana": {
    fit: "niche",
    note: "A caster-poke experiment rather than standard Jhin. Mana and Shock can support Q/W/R damage, but Tear delays his lane threat and the final item gives no crit for Whisper.",
  },
};

items.forEach((item) => {
  const read = jhinReads[item.name];
  if (!read) throw new Error(`Missing Jhin item read: ${item.name}`);
  item.fit = read.fit;
  item.caitlyn = read.note;
});

boots.splice(0, boots.length,
  {
    id: 3009, name: "Boots of Swiftness", label: "JHIN DEFAULT", stats: "55 MS · 25% slow resist · 1,000g", recommended: true,
    text: "Jhin’s usual offensive boot is movement, not firing speed. Swifties strengthen spacing between shots and make the post-fourth-shot escape or chase much more reliable.",
  },
  {
    id: 3006, name: "Berserker’s Greaves", label: "DAMAGE CONVERSION", stats: "30% AS · 45 MS · 1,100g",
    text: "They do not make Jhin shoot or reload faster. Whisper converts the attack speed into more attack damage and stronger crit movement, making this a damage choice rather than a cadence choice.",
  },
  {
    id: 3047, name: "Plated Steelcaps", label: "VS ATTACKS", stats: "25 armor · 45 MS · 1,200g",
    text: "The correct pivot when physical attackers can reach Jhin. Reducing attack damage helps him survive the exposed reload window and is worth more than greedy damage when focused.",
  },
  {
    id: 3111, name: "Mercury’s Treads", label: "VS MAGIC + CC", stats: "20 MR · 30% tenacity · 45 MS · 1,250g",
    text: "Take them into meaningful magic damage plus reducible crowd control. Tenacity does not solve suppression or knockups; Mercurial may be required for one decisive disable.",
  },
);

document.querySelectorAll(".caitlyn-note b").forEach((label) => { label.textContent = "JHIN READ"; });
document.querySelector("#item-total").textContent = items.length + boots.length;
renderBoots();
renderItems(items);
