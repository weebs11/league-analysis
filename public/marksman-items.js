const PATCH = "16.16.1";
const ICON = (id) => `https://ddragon.leagueoflegends.com/cdn/${PATCH}/img/item/${id}.png`;

const FIT_LABELS = {
  excellent: "Excellent on Caitlyn",
  strong: "Strong on Caitlyn",
  situational: "Situational",
  niche: "Niche / usually skip",
};

const FAMILY_LABELS = {
  crit: "Crit",
  speed: "Attack speed",
  penetration: "Anti-tank",
  defense: "Defense",
  specialist: "Specialist",
};

const items = [
  {
    id: 1086, name: "Doran’s Bow", cost: 400, family: "speed", families: ["speed", "specialist"], fit: "strong",
    stats: ["8 attack damage", "15% attack speed", "1.5% omnivamp"],
    effect: "A pure offense starter: damage, early attack speed, and a small amount of healing from all damage you deal. Unlike Doran’s Blade, it gives no health.",
    use: "Your lane is safe enough to trade durability for pressure, faster last-hits, and better early all-ins. It is the greedy combat start—not the sustain start.",
    caitlyn: "Good when your range advantage is reliable and the enemy lane cannot force hard engages. The attack speed makes early spacing and Headshot cycles feel cleaner.",
  },
  {
    id: 1055, name: "Doran’s Blade", cost: 450, family: "defense", families: ["defense", "specialist"], fit: "strong",
    stats: ["10 attack damage", "80 health", "2.5% omnivamp"],
    effect: "The balanced AD starter. It pairs useful damage with 80 health and omnivamp, giving you more room to survive trades and engage lanes.",
    use: "The lane can hit back: hook supports, burst lanes, or matchups where one extra spell or basic attack decides whether you live.",
    caitlyn: "The safer default into volatile lanes. Caitlyn already owns range; Blade helps cover the durability she does not own.",
  },
  {
    id: 1083, name: "Cull", cost: 450, family: "specialist", families: ["specialist"], fit: "situational",
    stats: ["7 attack damage", "3 health on-hit", "450g completion payout"],
    effect: "Pays 1 extra gold for each of the first 100 minions you kill, then grants a 350-gold completion payout. It is an investment with weak immediate combat stats.",
    use: "The lane has become a farm handshake, you recalled on an awkward amount of gold, or you are confident the enemy cannot punish your delayed combat power.",
    caitlyn: "Acceptable in genuinely quiet lanes, but it fights Caitlyn’s early lane-control identity. Do not buy it while behind against a lane that can dive or force dragons.",
  },
  {
    id: 2523, name: "Hexoptics C44", cost: 2800, family: "crit", families: ["crit"], fit: "excellent",
    stats: ["55 attack damage", "25% crit chance"],
    effect: "Magnification increases attack damage by up to 10% with distance (maximum at 500 range). A nearby takedown on a champion you damaged grants 100 attack range for 8 seconds.",
    use: "You are a long-range crit champion who can begin fights safely, then use a takedown to keep firing from even farther away.",
    caitlyn: "Nearly written for her: Caitlyn naturally attacks beyond 500 range, and the takedown range extension turns one won exchange into a chase or cleanup window.",
  },
  {
    id: 3032, name: "Yun Tal Wildarrows", cost: 3000, family: "crit", families: ["crit", "speed"], fit: "strong",
    stats: ["50 attack damage", "45% attack speed", "scales to 25% crit"],
    effect: "Begins at 0% crit and permanently builds to 25% through attacks. Attacking a champion triggers a 30% attack-speed burst for 6 seconds; attacks reduce that effect’s cooldown.",
    use: "You want a scaling first item and expect enough time to stack it. It rewards sustained attacking and becomes a complete AD/AS/crit package after investment.",
    caitlyn: "A strong scaling opener when lane tempo allows the stacking period. Better for repeated autos than a short trap-and-Headshot burst, so match it to how fights are playing out.",
  },
  {
    id: 3097, name: "Stormrazor", cost: 3200, family: "crit", families: ["crit", "speed"], fit: "excellent",
    stats: ["50 attack damage", "20% attack speed", "25% crit chance"],
    effect: "Moving and attacking charges an Energized hit. That hit deals 100 bonus magic damage and gives 45% movement speed for 1.5 seconds.",
    use: "You need one sharp trade followed by a reposition: hit, use the speed burst to kite out, then recharge before the next exchange.",
    caitlyn: "Excellent for safe poke and spacing. It gives all three crit-carry stats and helps her turn a long-range hit into either escape distance or a cleaner follow-up angle.",
  },
  {
    id: 3508, name: "Essence Reaver", cost: 3050, family: "crit", families: ["crit", "specialist"], fit: "situational",
    stats: ["50 attack damage", "20 ability haste", "25% crit chance"],
    effect: "After an ability, your next attack deals 125% base AD plus up to 50% more base AD based on crit chance, then restores mana equal to 50% of that proc (1.5-second cooldown).",
    use: "Your champion casts frequently, can reliably follow spells with an attack, and values both mana freedom and basic-ability haste.",
    caitlyn: "Playable for a spell-weaving, mana-hungry style, but she does not trigger Spellblade as relentlessly as Lucian or Smolder. Usually less direct than her range/crit options.",
  },
  {
    id: 6676, name: "The Collector", cost: 3000, family: "crit", families: ["crit", "penetration"], fit: "excellent",
    stats: ["50 attack damage", "10 lethality", "25% crit chance"],
    effect: "Executes champions damaged below 5% health and adds 25 bonus gold to champion kills. Lethality is strongest against low-armor targets.",
    use: "The enemy team is squishy, you are ahead enough to press tempo, or your damage pattern repeatedly leaves targets at a sliver of health.",
    caitlyn: "A potent snowball and squishy-target item: Q, Headshot, and Ace in the Hole all appreciate AD plus lethality. Replace it with percentage penetration against real armor.",
  },
  {
    id: 2512, name: "Fiendhunter Bolts", cost: 2650, family: "crit", families: ["crit", "speed", "specialist"], fit: "situational",
    stats: ["45% attack speed", "25% crit chance", "4% move speed", "30 ultimate haste"],
    effect: "After casting your ultimate, your next three attacks within eight seconds gain 50% attack speed and are forced crits at 80% normal crit damage. Attacks that would already crit instead deal 15% bonus true damage.",
    use: "Your champion can cast R immediately before or during a fight and safely deliver three follow-up attacks. It is an ultimate-to-attacks bridge, not a generic Zeal replacement.",
    caitlyn: "Situational. More Ace in the Hole casts are useful, but the channel often happens before a fight or during cleanup. Buy only when the R-to-three-attacks sequence is realistic.",
  },
  {
    id: 3031, name: "Infinity Edge", cost: 3500, family: "crit", families: ["crit"], fit: "excellent",
    stats: ["75 attack damage", "25% crit chance", "+30% crit damage"],
    effect: "The crit capstone. It provides the largest raw AD in the crit shop and makes every critical strike hit substantially harder.",
    use: "You already have or are committing to crit and need to convert that chance into heavier attacks. It is a multiplier, so it improves as the rest of the build comes online.",
    caitlyn: "Her signature multiplier. Heavy AD and enhanced crits amplify both ordinary attacks and the Headshot-centric pattern she uses to punish traps and nets.",
  },
  {
    id: 6673, name: "Immortal Shieldbow", cost: 3000, family: "defense", families: ["crit", "defense"], fit: "strong",
    stats: ["55 attack damage", "25% crit chance", "Lifeline shield"],
    effect: "Damage that would take you below 30% health triggers a three-second, level-scaling shield (reduced to 80% of the listed 400–700 value for ranged users; 90-second cooldown).",
    use: "An assassin or diver can reach you and nearly kill you in one rotation. Buy it before the death happens, not after the enemy has already taken control.",
    caitlyn: "The cleanest defensive crit slot. It costs offensive ceiling, but staying alive long enough to Net away and fire another Headshot is often more damage in practice.",
  },
  {
    id: 3046, name: "Phantom Dancer", cost: 2650, family: "speed", families: ["crit", "speed"], fit: "situational",
    stats: ["65% attack speed", "25% crit chance", "10% move speed"],
    effect: "The highest sustained attack-speed and movement package among crit items. Spectral Waltz also makes you Ghosted, so units cannot body-block your movement.",
    use: "You can already stand and fire, but need maximum attack cadence and smoother kiting through crowded fights.",
    caitlyn: "Powerful sustained stats, but often more attack speed than her slower, heavier-hit pattern needs. Best when long front-to-back fights are actually available.",
  },
  {
    id: 3094, name: "Rapid Firecannon", cost: 2650, family: "crit", families: ["crit", "speed"], fit: "excellent",
    stats: ["35% attack speed", "25% crit chance", "4% move speed"],
    effect: "Your Energized attack gains 35% bonus range and deals 40 bonus magic damage. It improves one charged shot, not every attack.",
    use: "The fight is decided by who touches whom first, or normal attack range puts you inside dangerous engage and retaliation zones.",
    caitlyn: "One of her best access tools. It compounds her native 650 range and lets a trap-empowered or ordinary hit start from unusually safe ground.",
  },
  {
    id: 3085, name: "Runaan’s Hurricane", cost: 2650, family: "speed", families: ["crit", "speed"], fit: "niche",
    stats: ["40% attack speed", "25% crit chance", "5% move speed"],
    effect: "Ranged attacks fire bolts at two nearby enemies. Each bolt deals 55% AD physical damage, applies on-hit effects, and can crit.",
    use: "Your champion has powerful on-hit interactions or wants to hit several tightly grouped frontliners at once—Jinx, Twitch, Ashe, and on-hit carries are common beneficiaries.",
    caitlyn: "Usually skip. Her value is concentrated into one target and her special Headshots are not meaningfully multiplied by Hurricane the way true on-hit kits are.",
  },
  {
    id: 6675, name: "Navori Flickerblade", cost: 2650, family: "speed", families: ["crit", "speed", "specialist"], fit: "niche",
    stats: ["40% attack speed", "25% crit chance", "4% move speed"],
    effect: "Every attack reduces each basic ability’s remaining cooldown by 15%. It turns uninterrupted attack uptime into more spell casts.",
    use: "Your basic abilities are the reason you win fights and your kit can attack often enough to cycle them repeatedly—Xayah and Lucian are natural examples.",
    caitlyn: "A niche trap/net cycling experiment. Her fights rarely give enough uninterrupted autos to outperform a harder single-hit purchase, especially before she is already safe.",
  },
  {
    id: 3072, name: "Bloodthirster", cost: 3400, family: "defense", families: ["defense"], fit: "strong",
    stats: ["80 attack damage", "15% life steal", "overheal shield"],
    effect: "Large AD plus lifesteal. Healing beyond full health becomes a persistent shield scaling from 165 to 315 with level, so pre-fight farming creates a buffer.",
    use: "You survive the first hit but lose fights to attrition, poke, or repeated chip damage. It also stabilizes side-lane farming between objectives.",
    caitlyn: "Excellent high-AD sustain when crit chance is already healthy. She can use her range to preserve the overheal shield and enter fights with a larger effective health bar.",
  },
  {
    id: 6672, name: "Kraken Slayer", cost: 3000, family: "speed", families: ["speed", "penetration"], fit: "niche",
    stats: ["45 attack damage", "40% attack speed", "4% move speed"],
    effect: "Every third attack deals 150–200 bonus physical damage by level (120–160 for ranged users), increased by up to 75% as the target loses health. It rewards repeated three-hit cycles.",
    use: "Your champion attacks rapidly and fights are long enough to proc the third hit several times. It is sustained single-target damage, not an armor-penetration item by itself.",
    caitlyn: "Usually weaker than crit burst paths. Her spacing often produces isolated heavy shots rather than uninterrupted three-hit cycles; buy only when sustained uptime is unusually easy.",
  },
  {
    id: 3087, name: "Statikk Shiv", cost: 3000, family: "speed", families: ["speed", "specialist"], fit: "niche",
    stats: ["45 attack damage", "45 ability power", "30% attack speed", "4% move speed"],
    effect: "Energized attacks fire chain lightning to nearby targets and apply on-hit effects. Basic attacks accelerate Energized charging.",
    use: "A hybrid-scaling carry wants waveclear, mixed damage, and frequent Energized chains. The AP is wasted unless the champion’s kit can use it.",
    caitlyn: "The chain can help wave control, but 45 AP is nearly dead gold for her. Stormrazor or a direct crit/AD item usually advances Caitlyn’s actual win condition better.",
  },
  {
    id: 3153, name: "Blade of the Ruined King", cost: 3200, family: "speed", families: ["speed", "penetration"], fit: "niche",
    stats: ["40 attack damage", "25% attack speed", "10% life steal"],
    effect: "Ranged attacks deal 6% of the target’s current health as bonus physical damage. Three attacks on a champion slow them by 30% for one second (15-second cooldown).",
    use: "Your champion is an on-hit user facing large health pools and can repeatedly attack the same target. It punishes health more directly than armor.",
    caitlyn: "Usually skip. She prefers crit multipliers and percentage armor penetration; the three-hit slow and current-health effect do not match her range-burst identity.",
  },
  {
    id: 3124, name: "Guinsoo’s Rageblade", cost: 3000, family: "speed", families: ["speed", "specialist"], fit: "niche",
    stats: ["30 attack damage", "30 ability power", "25% attack speed"],
    effect: "Adds 30 magic damage on-hit. Attacks stack attack speed; at four stacks, every third attack applies on-hit effects twice.",
    use: "Your kit already owns valuable on-hit effects and scales with rapid attacks. Rageblade is an engine for Vayne, Kog’Maw, Kai’Sa, or Varus-style patterns.",
    caitlyn: "A poor fit. She lacks a native every-hit effect worth duplicating, wastes much of the AP, and gives up the critical-hit scaling her Headshots want.",
  },
  {
    id: 3302, name: "Terminus", cost: 3000, family: "penetration", families: ["speed", "penetration", "defense"], fit: "niche",
    stats: ["30 attack damage", "35% attack speed", "on-hit magic damage"],
    effect: "Attacks add 30 +10% bonus AD +10% AP magic damage. Against champions, Light attacks stack 6–8 armor/MR and Dark attacks stack 10% dual penetration, each up to three times.",
    use: "A hybrid on-hit carry needs both penetration types and enough durability for extended fights. It is a late sustained-combat capstone, not immediate burst penetration.",
    caitlyn: "Usually skip. LDR gives immediate, larger physical penetration plus crit; Caitlyn rarely needs magic penetration or a ramping defensive on-hit pattern.",
  },
  {
    id: 3091, name: "Wit’s End", cost: 2800, family: "defense", families: ["speed", "defense", "specialist"], fit: "niche",
    stats: ["50% attack speed", "45 magic resist", "20% tenacity"],
    effect: "Adds 45 magic damage to every attack while supplying heavy attack speed, magic resistance, and tenacity. It is offense and magic-defense in one on-hit slot.",
    use: "An on-hit carry is facing meaningful magic damage and reducible crowd control. The item is valuable only if both the defensive stats and repeated on-hit damage matter.",
    caitlyn: "Emergency-only. The MR can be tempting, but Maw or Mercurial usually preserves more of Caitlyn’s AD-centric damage pattern.",
  },
  {
    id: 3115, name: "Nashor’s Tooth", cost: 2900, family: "speed", families: ["speed", "specialist"], fit: "niche",
    stats: ["80 ability power", "50% attack speed", "15 ability haste"],
    effect: "Attacks deal 15 +15% AP bonus magic damage on-hit. It connects AP spell scaling to repeated basic attacks.",
    use: "An AP-scaling marksman or ranged carry wants both rapid attacks and meaningful AP ratios—Kayle, Kai’Sa, or hybrid Varus-style builds—not an ordinary AD crit build.",
    caitlyn: "Skip in standard play. The Marksman shop flag means discoverability, not universal suitability; its AP-heavy budget does not support Caitlyn’s AD/crit Headshot plan.",
  },
  {
    id: 3036, name: "Lord Dominik’s Regards", cost: 3300, family: "penetration", families: ["crit", "penetration"], fit: "excellent",
    stats: ["35 attack damage", "35% armor penetration", "25% crit chance"],
    effect: "Penetrates 35% of armor and deals up to 15% bonus damage based on enemy bonus health, reaching maximum value at 1,500 bonus health.",
    use: "Armor and bonus-health stacking are reducing your attacks. Percentage penetration gets more valuable as enemy armor rises, so do not leave it until the game is already lost.",
    caitlyn: "Her default tank answer and often a third-item priority. It keeps crit scaling intact while making every Headshot, Q, and attack matter against frontliners.",
  },
  {
    id: 3033, name: "Mortal Reminder", cost: 3000, family: "penetration", families: ["crit", "penetration"], fit: "strong",
    stats: ["35 attack damage", "30% armor penetration", "25% crit chance"],
    effect: "Physical damage applies 40% Grievous Wounds for three seconds, reducing the target’s healing. It trades some penetration and Giant Slayer for anti-heal.",
    use: "Healing is deciding fights—Soraka, Aatrox, Vladimir, major lifesteal—and your team lacks a reliable Wounds applier. Do not buy it for trivial sustain.",
    caitlyn: "A clean LDR alternative when anti-heal is truly your responsibility. Her long range makes applying Wounds easy, but LDR deals more when healing is not the constraint.",
  },
  {
    id: 3139, name: "Mercurial Scimitar", cost: 3200, family: "defense", families: ["defense", "specialist"], fit: "strong",
    stats: ["50 attack damage", "35 magic resist", "10% life steal"],
    effect: "Its 90-second active removes all crowd-control debuffs except Airborne, then grants 50% bonus total movement speed and Ghosted for two seconds.",
    use: "One removable effect—Malzahar R, Mordekaiser R, Ashe R, a long root—is the consistent reason you cannot play. Buy QSS earlier if the cleanse is urgent.",
    caitlyn: "Excellent when the active has a named job. Range cannot protect her from point-and-click suppression or a cross-map arrow; the cleanse can restore her entire fight.",
  },
  {
    id: 3026, name: "Guardian Angel", cost: 3200, family: "defense", families: ["defense"], fit: "strong",
    stats: ["55 attack damage", "45 armor", "revive"],
    effect: "Lethal damage puts you in Stasis for four seconds, then restores 50% base health and all mana. Rebirth has a five-minute cooldown.",
    use: "Physical divers must commit everything to kill you and your team can control the area during the revive. Weak when enemies can simply wait beside the body.",
    caitlyn: "Strong for decisive late objectives. Her team can trap around the revive location, but do not buy GA if the enemy can camp the body and your team cannot contest.",
  },
  {
    id: 3156, name: "Maw of Malmortius", cost: 3100, family: "defense", families: ["defense", "specialist"], fit: "situational",
    stats: ["60 attack damage", "15 ability haste", "40 magic resist"],
    effect: "Magic damage that would take you below 30% health triggers a three-second magic shield (150 +112.5% bonus AD for ranged users) and grants 10% omnivamp until combat ends.",
    use: "A magic burst champion is the specific threat. Maw is poor into physical damage and shares the Lifeline restriction with Shieldbow.",
    caitlyn: "A legitimate anti-AP emergency slot with useful AD. Choose it over Shieldbow only when magic damage is clearly the lethal part of the enemy combo.",
  },
  {
    id: 3004, iconId: 3042, name: "Manamune → Muramana", cost: 2900, family: "specialist", families: ["specialist"], fit: "niche",
    stats: ["35 attack damage", "500→1,000 mana", "15 ability haste"],
    effect: "Stacks to 360 bonus mana, then transforms. Muramana converts 2% max mana into AD and spends that mana pool on bonus physical damage from attacks and damaging abilities.",
    use: "Your champion is mana-hungry, applies Shock efficiently with spells and attacks, and can tolerate buying Tear plus a delayed transformation.",
    caitlyn: "A niche poke build, not a standard crit plan. Q and R can use the spell proc, but the delayed spike and missing crit usually cost more than the mana solves.",
  },
];

const boots = [
  {
    id: 3006, name: "Berserker’s Greaves", label: "DEFAULT DAMAGE", stats: "30% AS · 45 MS · 1,100g", recommended: true,
    text: "The standard marksman boot, buffed to 30% attack speed in 26.16. On a bot-lane Role Quest upgrade, it becomes Gunmetal Greaves: 45% attack speed and 5% lifesteal (the old on-hit move-speed passive was removed).",
  },
  {
    id: 3047, name: "Plated Steelcaps", label: "VS ATTACKS", stats: "25 armor · 45 MS · 1,200g",
    text: "Buy when physical attackers and basic attacks are the danger. Reducing incoming attack damage can create far more firing time than the attack speed you give up.",
  },
  {
    id: 3111, name: "Mercury’s Treads", label: "VS MAGIC + CC", stats: "20 MR · 30% tenacity · 45 MS · 1,250g",
    text: "Buy into meaningful magic damage plus reducible crowd control. Tenacity does not solve knockups or suppression; Mercurial may be the actual answer to one key disable.",
  },
  {
    id: 3009, name: "Boots of Swiftness", label: "VS SLOWS / FOR SPACING", stats: "55 MS · 25% slow resist · 1,000g",
    text: "A spacing specialist. Useful when slows repeatedly ruin your kiting or when raw movement speed matters more than attack speed—common on Jhin, occasional on Caitlyn.",
  },
];

function renderMiniIcons() {
  document.querySelectorAll("[data-icons]").forEach((wrap) => {
    wrap.replaceChildren(...wrap.dataset.icons.split(",").map((id) => {
      const img = document.createElement("img");
      img.src = ICON(id);
      img.alt = "";
      img.width = 46;
      img.height = 46;
      return img;
    }));
  });
}

function renderItems(filtered) {
  const grid = document.querySelector("#item-grid");
  const template = document.querySelector("#item-card-template");
  const fragment = document.createDocumentFragment();

  filtered.forEach((item) => {
    const node = template.content.firstElementChild.cloneNode(true);
    node.dataset.fit = item.fit;
    node.dataset.family = item.family;
    const image = node.querySelector(".item-icon");
    image.src = ICON(item.iconId || item.id);
    image.alt = `${item.name} icon`;
    node.querySelector("h3").textContent = item.name;
    node.querySelector(".cost").textContent = `${item.cost.toLocaleString()} GOLD`;
    node.querySelector(".family-badge").textContent = FAMILY_LABELS[item.family];
    node.querySelector(".fit-badge").textContent = FIT_LABELS[item.fit];
    node.querySelector(".stats").replaceChildren(...item.stats.map((stat) => {
      const span = document.createElement("span");
      span.className = "stat-pill";
      span.textContent = stat;
      return span;
    }));
    node.querySelector(".effect").textContent = item.effect;
    node.querySelector(".general-use").textContent = item.use;
    node.querySelector(".caitlyn-note p").textContent = item.caitlyn;
    fragment.append(node);
  });

  grid.replaceChildren(fragment);
  document.querySelector("#result-count").textContent = `${filtered.length} OF ${items.length} ITEMS`;
  document.querySelector("#empty-state").hidden = filtered.length !== 0;
}

function renderBoots() {
  const fragment = document.createDocumentFragment();
  boots.forEach((boot) => {
    const card = document.createElement("article");
    card.className = `boot-card${boot.recommended ? " recommended" : ""}`;
    card.innerHTML = `
      <img src="${ICON(boot.id)}" alt="${boot.name} icon" width="54" height="54" loading="lazy" />
      <span class="boot-label">${boot.label}</span>
      <h3>${boot.name}</h3>
      <p class="boot-stats">${boot.stats}</p>
      <p>${boot.text}</p>`;
    fragment.append(card);
  });
  document.querySelector("#boot-grid").replaceChildren(fragment);
}

let family = "all";
let fit = "all";

function applyFilters() {
  const query = document.querySelector("#item-search").value.trim().toLowerCase();
  renderItems(items.filter((item) => {
    const familyMatch = family === "all" || item.families.includes(family);
    const fitMatch = fit === "all" || item.fit === fit;
    const haystack = [item.name, ...item.stats, item.effect, item.use, item.caitlyn].join(" ").toLowerCase();
    return familyMatch && fitMatch && (!query || haystack.includes(query));
  }));
}

document.querySelector("#item-search").addEventListener("input", applyFilters);
document.querySelector("#family-filters").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-family]");
  if (!button) return;
  family = button.dataset.family;
  document.querySelectorAll("button[data-family]").forEach((candidate) => candidate.classList.toggle("active", candidate === button));
  applyFilters();
});
document.querySelector("#fit-filters").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-fit]");
  if (!button) return;
  fit = button.dataset.fit;
  document.querySelectorAll("button[data-fit]").forEach((candidate) => candidate.classList.toggle("active", candidate === button));
  applyFilters();
});
document.querySelector("#reset-filters").addEventListener("click", () => {
  family = "all";
  fit = "all";
  document.querySelector("#item-search").value = "";
  document.querySelectorAll("button[data-family]").forEach((button) => button.classList.toggle("active", button.dataset.family === "all"));
  document.querySelectorAll("button[data-fit]").forEach((button) => button.classList.toggle("active", button.dataset.fit === "all"));
  applyFilters();
});

document.querySelector("#item-total").textContent = items.length + boots.length;
renderMiniIcons();
renderBoots();
renderItems(items);
