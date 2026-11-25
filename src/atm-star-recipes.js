// ATM10 8.6: Runic Star Altar, att_items.js and atm_alloys.js.
const item = (id, label, filter = {}) => ({ key: id, id, label, ...filter });
const amount = (count, ...options) => ({ count, options });
const use = (id, label, count = 1, filter) => amount(count, item(id, label, filter));
const part = (id, label, count, ingredients, filter) => ({ ...use(id, label, count, filter), ingredients });
const blood = (id, amount) => ({ 'cyclopscore:fluid_content': { id, amount } });
const awakenedName = 'Awakened Unobtainium-Vibranium Alloy Block';

export const ATM_STAR_GOAL = 18;
export const atmStar = item('allthetweaks:atm_star', 'ATM Star');
export const atmStarBlock = item('allthetweaks:atm_star_block', 'ATM Star Block');
export const netherStarStock = [
  ['minecraft:nether_star', 'Netherstern', 1],
  ['allthetweaks:nether_star_block', 'Nethersternblock', 9],
  ['allthecompressed:nether_star_block_1x', 'Nethersternblock 1x', 81],
  ['allthecompressed:nether_star_block_2x', 'Nethersternblock 2x', 729],
  ['allthecompressed:nether_star_block_3x', 'Nethersternblock 3x', 6561],
].map(([id, label, units]) => ({ ...item(id, label), units }));

export const atmStarParts = [
  part('allthecompressed:nether_star_block_3x', 'Nethersternblock 3x', 15, [
    use('allthecompressed:nether_star_block_2x', 'Nethersternblock 2x', 9),
  ]),
  part('allthemodium:unobtainium_allthemodium_alloy_block', 'Unobtainium-Allthemodium Alloy Block', 28, [
    use('allthemodium:piglich_heart_block', 'Piglich Heart Block', 2),
    use('kubejs:air_essence_block', 'Air Essence Block'),
    use('allthemodium:allthemodium_block', 'Allthemodium Block'),
    use('kubejs:earth_essence_block', 'Earth Essence Block'),
    use('kubejs:fire_essence_block', 'Fire Essence Block'),
    use('allthemodium:unobtainium_block', 'Unobtainium Block'),
    use('kubejs:water_essence_block', 'Water Essence Block'),
    use('ars_nouveau:source_gem_block', 'Source Gem Block'),
  ]),
  part('allthemodium:unobtainium_vibranium_alloy_block', awakenedName, 2, [
    use('allthemodium:unobtainium_vibranium_alloy_block', 'Unobtainium-Vibranium Alloy Block', 1, { excludedName: awakenedName }),
    use('mysticalagriculture:awakened_supremium_essence', 'Awakened Supremium Essence', 4),
    use('minecraft:enchanted_book', 'Verzaubertes Buch (Unbreaking I)', 4, {
      key: 'unbreaking-book', components: { 'minecraft:stored_enchantments': { levels: { 'minecraft:unbreaking': 1 } } },
    }),
    use('mysticalagriculture:awakened_supremium_gemstone', 'Awakened Supremium Gemstone', 4),
  ], { key: 'awakened-alloy-block', displayName: awakenedName, components: { 'minecraft:enchantments': { levels: { 'minecraft:unbreaking': 1 } } } }),
  part('allthetweaks:oblivion_shard', 'Oblivion Shard', 1, [
    use('forbidden_arcanus:eternal_stella', 'Eternal Stella'),
    use('evilcraft:mace_of_destruction', 'Mace of Destruction (4.000 mB Blood)', 1, { components: blood('evilcraft:blood', 4000) }),
    use('evilcraft:piercing_vengeance_focus', 'Piercing Vengeance Focus', 2),
    use('stevescarts:module_galgadorian_drill', 'Galgadorian Drill', 2),
    use('cataclysm:meat_shredder', 'Meat Shredder'),
    use('twilightforest:snow_queen_trophy', 'Snow Queen Trophy'),
    use('cataclysm:void_forge', 'Void Forge'),
  ]),
  part('mysticalagradditions:creative_essence', 'Creative Essence', 1, [
    use('mysticalagradditions:insanium_block', 'Insanium Block', 4),
    use('mysticalagradditions:insanium_gemstone_block', 'Insanium Gemstone Block', 4),
    use('mysticalagriculture:master_infusion_crystal', 'Master Infusion Crystal'),
  ]),
  part('allthetweaks:nexium_emitter', 'Nexium Emitter', 1, [
    use('powah:player_transmitter_nitro', 'Player Transmitter (Nitro)'),
    use('ae2wtlib:wireless_universal_terminal', 'Wireless Universal Terminal (4 Terminalmodule, voll geladen)', 1, {
      components: { 'ae2wtlib:has_ex_pattern_access_terminal': {}, 'ae2wtlib:has_pattern_encoding_terminal': {},
        'ae2wtlib:has_crafting_terminal': {}, 'ae2wtlib:has_pattern_access_terminal': {}, 'ae2:stored_energy': 6400000 },
    }),
    use('mekanism:module_gravitational_modulating_unit', 'Gravitational Modulating Unit'),
    amount(1, item('modern_industrialization:large_advanced_motor', 'Large Advanced Motor'), item('create:mechanical_arm', 'Mechanical Arm')),
    use('immersiveengineering:tesla_coil', 'Tesla Coil'),
    use('advanced_ae:quantum_multi_threader', 'Quantum Multi-Threader'),
    use('aeinfinitybooster:infinity_card', 'Infinity Card'),
  ]),
  part('allthetweaks:withers_compass', 'Wither’s Compass', 1, [
    use('productivebees:configurable_comb', 'Withered Comb', 1, { components: { 'productivebees:bee_type': 'productivebees:withered' } }),
    use('industrialforegoing:wither_builder', 'Wither Builder'),
    use('deeperdarker:heart_of_the_deep', 'Heart of the Deep'),
    use('generatorgalore:netherstar_generator_64x', 'Nether Star Generator 64x'),
    use('irons_spellbooks:scroll', 'Wither Skull Scroll (Level 10)', 1, { components: {
      'irons_spellbooks:spell_container': { data: [{ id: 'irons_spellbooks:wither_skull', index: 0, level: 10, locked: true }], maxSpells: 1, mustEquip: false, spellWheel: false },
    } }),
    use('mysticalagriculture:witherproof_bricks', 'Witherproof Bricks'),
    use('minecraft:tipped_arrow', 'Pfeil (Long Wither)', 1, { components: { 'minecraft:potion_contents': { potion: 'apothic_attributes:long_wither' } } }),
    use('ars_nouveau:glyph_wither', 'Glyph of Wither'),
    use('mysticalagradditions:nether_star_crux', 'Nether Star Crux'),
  ]),
  part('allthetweaks:improbable_probability_device', 'Improbable Probability Device', 1, [
    use('mekanism:pellet_antimatter', 'Antimatter Pellet', 2),
    use('ae2:singularity', 'Singularity'),
    amount(2, item('megacells:portable_item_cell_256m', 'Portable 256M Item Cell'), item('modern_industrialization:blastproof_casing', 'Blastproof Casing')),
    use('pneumaticcraft:aerial_interface', 'Aerial Interface'),
    use('ironfurnaces:million_furnace', 'Million Furnace', 2),
    use('irons_spellbooks:lightning_upgrade_orb', 'Lightning Upgrade Orb'),
  ]),
  part('allthetweaks:dragon_soul', 'Dragon Soul', 1, [
    use('apothic_enchanting:infused_breath', 'Infused Dragon’s Breath'),
    use('occultism:soul_gem', 'Soul Gem'),
    amount(1, item('justdirethings:creaturecatcher', 'Creature Catcher mit Dragon Familiar', { components: { 'justdirethings:entitytype': 'occultism:dragon_familiar' } }),
      item('occultism:spawn_egg/familiar_dragon', 'Dragon Familiar Spawn Egg')),
    use('productivetrees:socotra_dragon_sapling', 'Socotra Dragon Sapling'),
    use('hostilenetworks:data_model', 'Ender Dragon Data Model (1254 oder 1255 Daten)', 1, { components: {
      'hostilenetworks:data_model': 'hostilenetworks:ender_dragon', 'hostilenetworks:data': { oneOf: [1254, 1255] },
    } }),
    use('allthemodium:piglich_heart_block', 'Piglich Heart Block'),
    use('productivebees:spawn_egg_configurable_bee', 'Soul Lava Bee Spawn Egg', 1, { components: {
      'minecraft:entity_data': { id: 'productivebees:configurable_bee', type: 'productivebees:soul_lava' },
    } }),
    use('cataclysm:abyssal_sacrifice', 'Abyssal Sacrifice'),
    use('eternal_starlight:chain_of_souls', 'Chain of Souls'),
  ]),
  part('allthetweaks:philosophers_fuel', 'Philosopher’s Fuel', 1, [
    use('generatorgalore:ender_generator', 'Ender Generator'),
    use('ironfurnaces:rainbow_coal', 'Rainbow Coal'),
    use('bigreactors:insanite_block', 'Insanite Block'),
    amount(1, item('modern_industrialization:uranium_fuel_rod_quad', 'Quad Uranium Fuel Rod'), item('create:blaze_burner', 'Blaze Burner')),
    use('mysticalagradditions:insanium_coal_block', 'Insanium Coal Block'),
    use('forbidden_arcanus:smelter_prism', 'Smelter Prism'),
    use('mysticalagriculture:awakened_supremium_ingot_block', 'Awakened Supremium Ingot Block'),
    use('generatorgalore:magmatic_generator_64x', 'Magmatic Generator 64x'),
    use('evilcraft:dark_tank', 'Dark Tank (16.000 mB Refined T4 Fluid)', 1, { components: blood('justdirethings:refined_t4_fluid_source', 16000) }),
  ]),
  part('allthetweaks:pulsating_black_hole', 'Pulsating Black Hole', 1, [
    use('oritech:nuke', 'Nuke'),
    use('ae2:quantum_ring', 'Quantum Ring'),
    use('pneumaticcraft:micromissiles', 'Micromissiles'),
    use('justdirethings:paradoxmachine', 'Paradox Machine'),
    use('pocketstorage:psu_4', 'Pocket Storage Unit Tier 4'),
    use('occultism:stable_wormhole', 'Stable Wormhole'),
    use('rootsclassic:crystal_staff', 'Crystal Staff'),
    use('industrialforegoing:mycelial_explosive', 'Mycelial Explosive Generator'),
    use('evilcraft:lightning_bomb', 'Lightning Bomb'),
  ]),
  part('allthetweaks:dimensional_seed', 'Dimensional Seed', 1, [
    use('allthecompressed:netherrack_6x', 'Netherrack 6x'),
    use('neovitae:teleposer', 'Teleposer'),
    use('allthecompressed:obsidian_5x', 'Obsidian 5x'),
    use('allthetweaks:mini_exit', 'Miniature Exit Portal'),
    use('allthetweaks:mini_nether', 'Miniature Nether Portal'),
    use('allthetweaks:mini_end', 'Miniature End Portal'),
    use('allthecompressed:end_stone_5x', 'End Stone 5x'),
    use('allthecompressed:emerald_block_4x', 'Smaragdblock 4x'),
    use('allthecompressed:diamond_block_4x', 'Diamantblock 4x'),
  ]),
  part('allthetweaks:patrick_star', 'Patrick Star', 1, [
    use('minecraft:magenta_concrete', 'Magenta Beton', 13),
    use('minecraft:pink_concrete', 'Rosa Beton', 11),
    use('minecraft:green_concrete', 'Grüner Beton', 8),
    use('minecraft:green_concrete_powder', 'Grüner Trockenbeton', 8),
    use('minecraft:magenta_concrete_powder', 'Magenta Trockenbeton', 8),
    use('minecraft:pink_concrete_powder', 'Rosa Trockenbeton', 5),
    use('minecraft:lime_concrete', 'Hellgrüner Beton', 2),
  ]),
];

export const atmStarStockRules = [...new Map([
  atmStar, atmStarBlock, ...netherStarStock,
  ...atmStarParts.flatMap(({ options, ingredients }) => [...options, ...ingredients.flatMap(i => i.options)]),
].map(rule => [rule.key, rule])).values()].map(({ key, id, components, displayName, excludedName }) => ({
  key, id, components, displayName, excludedName,
}));

// ---------- Extended metadata (kept outside atmStarStockRules so revision stays pinned) ----------

export const NETHER_STARS_PER_STAR = 15 * 6561; // 98,415 Nether Stars per ATM Star

export const MOD_NAMES = Object.freeze({
  advanced_ae: 'Advanced AE',
  ae2: 'Applied Energistics 2',
  ae2wtlib: 'AE2 Wireless Terminals',
  aeinfinitybooster: 'AE Infinity Booster',
  allthecompressed: 'AllTheCompressed',
  allthemodium: 'Allthemodium',
  allthetweaks: 'AllTheTweaks',
  apothic_enchanting: 'Apothic Enchanting',
  ars_nouveau: 'Ars Nouveau',
  bigreactors: 'Extreme Reactors',
  cataclysm: 'L_Ender’s Cataclysm',
  create: 'Create',
  deeperdarker: 'Deeper and Darker',
  eternal_starlight: 'Eternal Starlight',
  evilcraft: 'EvilCraft',
  forbidden_arcanus: 'Forbidden & Arcanus',
  generatorgalore: 'Generator Galore',
  hostilenetworks: 'Hostile Neural Networks',
  immersiveengineering: 'Immersive Engineering',
  industrialforegoing: 'Industrial Foregoing',
  ironfurnaces: 'Iron Furnaces',
  irons_spellbooks: 'Iron’s Spells ’n Spellbooks',
  justdirethings: 'Just Dire Things',
  kubejs: 'ATM10 (KubeJS)',
  megacells: 'MEGA Cells',
  mekanism: 'Mekanism',
  minecraft: 'Minecraft',
  modern_industrialization: 'Modern Industrialization',
  mysticalagradditions: 'Mystical Agradditions',
  mysticalagriculture: 'Mystical Agriculture',
  neovitae: 'Blood Magic',
  occultism: 'Occultism',
  oritech: 'Oritech',
  pneumaticcraft: 'PneumaticCraft',
  pocketstorage: 'Pocket Storage',
  powah: 'Powah',
  productivebees: 'Productive Bees',
  productivetrees: 'Productive Trees',
  rootsclassic: 'Roots Classic',
  stevescarts: 'Steve’s Carts',
  twilightforest: 'Twilight Forest',
});

export function modInfo(itemId) {
  const namespace = String(itemId || '').split(':')[0] || 'unknown';
  return { id: namespace, label: MOD_NAMES[namespace] ?? namespace };
}

export const atmStarPartMeta = Object.freeze({
  'allthecompressed:nether_star_block_3x': {
    station: 'Kompression',
    stationDetail: '9× Nethersternblock 2x pro 3x-Block (6.561 Nethersterne)',
    category: 'Kompression',
  },
  'allthemodium:unobtainium_allthemodium_alloy_block': {
    station: 'Runic Crucible / Legierung',
    stationDetail: 'ATM-Legierungsblock aus 8 Blöcken (inkl. 2× Piglich Heart Block)',
    category: 'Legierungen',
  },
  'awakened-alloy-block': {
    station: 'Runic Enchanter',
    stationDetail: 'Erweckter Unobtainium-Vibranium Alloy Block mit Unbreaking I',
    category: 'Legierungen',
  },
  'allthetweaks:oblivion_shard': {
    station: 'Werkbank',
    stationDetail: 'Boss- & Endgame-Trophäen zu einem Oblivion Shard kombiniert',
    category: 'Komponenten',
  },
  'mysticalagradditions:creative_essence': {
    station: 'Infusion / Werkbank',
    stationDetail: 'Insanium-Blöcke, Gemstone-Blöcke und Master Infusion Crystal',
    category: 'Essenz',
  },
  'allthetweaks:nexium_emitter': {
    station: 'Werkbank',
    stationDetail: 'AE2-, Powah-, Mekanism- und Tech-Endgame-Module',
    category: 'Komponenten',
  },
  'allthetweaks:withers_compass': {
    station: 'Werkbank',
    stationDetail: 'Wither- und Boss-Komponenten inkl. Scroll Lv. 10 & Long-Wither-Pfeil',
    category: 'Komponenten',
  },
  'allthetweaks:improbable_probability_device': {
    station: 'Werkbank',
    stationDetail: 'Antimatter, Singularity und High-Tier-Maschinen',
    category: 'Komponenten',
  },
  'allthetweaks:dragon_soul': {
    station: 'Werkbank',
    stationDetail: 'Drachen- & Seelen-Komponenten inkl. Data Model (1254/1255) und Piglich Heart Block',
    category: 'Komponenten',
  },
  'allthetweaks:philosophers_fuel': {
    station: 'Werkbank',
    stationDetail: 'Energie- & Brennstoff-Komponenten inkl. Dark Tank (16.000 mB T4 Fluid)',
    category: 'Komponenten',
  },
  'allthetweaks:pulsating_black_hole': {
    station: 'Werkbank',
    stationDetail: 'Oritech, AE2 Quantum Ring, Paradox Machine und Magie-Artefakte',
    category: 'Komponenten',
  },
  'allthetweaks:dimensional_seed': {
    station: 'Werkbank',
    stationDetail: 'Hochkomprimierte Dimensionsblöcke (4x–6x) und Miniatur-Portale',
    category: 'Kompression',
  },
  'allthetweaks:patrick_star': {
    station: 'Mechanical Crafter',
    stationDetail: '55 Beton- und Trockenbetonblöcke in Patrick-Star-Form',
    category: 'Komponenten',
  },
});

export const atmStarItemRequirements = Object.freeze({
  'awakened-alloy-block': [
    {
      kind: 'name',
      badge: 'Name',
      label: 'Exakter Anzeigename',
      detail: 'Anzeigename muss exakt „Awakened Unobtainium-Vibranium Alloy Block“ lauten.',
    },
    {
      kind: 'enchant',
      badge: 'Unbreaking I',
      label: 'Verzauberung Unbreaking I',
      detail: 'Komponente minecraft:enchantments mit minecraft:unbreaking Stufe 1 erforderlich.',
    },
  ],
  'allthemodium:unobtainium_vibranium_alloy_block': [
    {
      kind: 'name',
      badge: 'Nicht erweckt',
      label: 'Normale Legierungsvariante',
      detail: 'Darf nicht den Anzeigenamen „Awakened Unobtainium-Vibranium Alloy Block“ tragen.',
    },
  ],
  'unbreaking-book': [
    {
      kind: 'enchant',
      badge: 'Unbreaking I',
      label: 'Verzaubertes Buch (Unbreaking I)',
      detail: 'Gespeicherte Verzauberung minecraft:unbreaking Stufe 1 in minecraft:stored_enchantments.',
    },
  ],
  'evilcraft:mace_of_destruction': [
    {
      kind: 'fluid',
      badge: '4.000 mB Blood',
      label: '4.000 mB EvilCraft Blood',
      detail: 'Muss exakt mit 4.000 mB evilcraft:blood gefüllt sein (cyclopscore:fluid_content).',
    },
  ],
  'ae2wtlib:wireless_universal_terminal': [
    {
      kind: 'energy',
      badge: '6,4M AE',
      label: 'Voll geladen (6.400.000 AE)',
      detail: 'Komponente ae2:stored_energy muss exakt 6.400.000 betragen.',
    },
    {
      kind: 'module',
      badge: '4 Terminalmodule',
      label: 'Alle 4 Terminalmodule installiert',
      detail: 'Crafting, Pattern Encoding, Pattern Access und Extended Pattern Access Terminal müssen enthalten sein.',
    },
  ],
  'productivebees:configurable_comb': [
    {
      kind: 'nbt',
      badge: 'Withered Bee',
      label: 'Bienentyp: Withered',
      detail: 'Komponente productivebees:bee_type muss productivebees:withered sein.',
    },
  ],
  'irons_spellbooks:scroll': [
    {
      kind: 'spell',
      badge: 'Wither Skull Lv. 10',
      label: 'Zauberrolle Wither Skull Stufe 10',
      detail: 'irons_spellbooks:spell_container mit irons_spellbooks:wither_skull auf Level 10 (gesperrt, Slot 0).',
    },
  ],
  'minecraft:tipped_arrow': [
    {
      kind: 'potion',
      badge: 'Long Wither',
      label: 'Trankeffekt Long Wither',
      detail: 'minecraft:potion_contents.potion muss apothic_attributes:long_wither sein.',
    },
  ],
  'justdirethings:creaturecatcher': [
    {
      kind: 'entity',
      badge: 'Dragon Familiar',
      label: 'Gefangene Kreatur: Dragon Familiar',
      detail: 'justdirethings:entitytype muss occultism:dragon_familiar enthalten.',
    },
  ],
  'hostilenetworks:data_model': [
    {
      kind: 'data',
      badge: '1254–1255 Daten',
      label: 'Ender Dragon Data Model (Self Aware)',
      detail: 'hostilenetworks:data_model = hostilenetworks:ender_dragon mit exakt 1254 oder 1255 Daten.',
    },
  ],
  'productivebees:spawn_egg_configurable_bee': [
    {
      kind: 'entity',
      badge: 'Soul Lava Bee',
      label: 'Spawn-Ei: Soul Lava Bee',
      detail: 'minecraft:entity_data mit id=productivebees:configurable_bee und type=productivebees:soul_lava.',
    },
  ],
  'evilcraft:dark_tank': [
    {
      kind: 'fluid',
      badge: '16.000 mB T4 Fluid',
      label: '16.000 mB Refined T4 Fluid',
      detail: 'Muss exakt 16.000 mB justdirethings:refined_t4_fluid_source enthalten (cyclopscore:fluid_content).',
    },
  ],
});

export const starryBeeRoadmap = Object.freeze({
  title: 'Produktion mit der Starry Bee',
  subtitle: 'Vom ersten ATM Star bis zur endlosen Shard-Automatisierung',
  steps: [
    {
      step: 1,
      id: 'stars-18',
      title: '18 ATM Stars herstellen',
      detail: 'Zwei ATM Star Blocks (je 9 Stars) bilden die Basis für Umwandlung und Futterblock.',
      targetStars: 18,
    },
    {
      step: 2,
      id: 'patrick-bee',
      title: 'Patrick Bee angeln & umwandeln',
      detail: 'Patrick Bee im Warm Ocean angeln und den ersten ATM Star Block für die Umwandlung zur Starry Bee verwenden.',
      targetStars: 9,
      targetBlocks: 1,
    },
    {
      step: 3,
      id: 'starry-beehive',
      title: 'Starry Bee & Centrifuge anbinden',
      detail: 'Den zweiten ATM Star Block vor dem Advanced Beehive auf den Feeding Slab setzen. Starry Combs in der Powered Centrifuge verarbeiten und ATM Star Shards zurück ins ME leiten.',
      targetStars: 18,
      targetBlocks: 2,
    },
    {
      step: 4,
      id: 'altar-automation',
      title: 'Runic Star Altar automatisieren',
      detail: 'Pro weiterem Star 292 Shards einplanen (5 Star-Fragmente, Infused Patrick Star, Corrupti Dust, Mundabitur Dust, Lens of the Killer). Automatic Hephaestus Forge, Runic Crucible, Runic Enchanter und Atomic Reconstructor über Processing Patterns an die Item Input Hatch anbinden und per ME Import Bus zurückführen.',
      shardsPerStar: 292,
    },
  ],
  links: [
    {
      label: 'Altar-Rezepte in ATM10 8.6',
      href: 'https://github.com/AllTheMods/ATM-10/blob/8.6/kubejs/server_scripts/modpack/runic_multis/recipes/star_altar.js',
    },
    {
      label: 'Creative-Questreihe',
      href: 'https://github.com/AllTheMods/ATM-10/blob/8.6/config/ftbquests/quests/lang/en_us/chapters/achapter_2r_6the_atm_star.snbt',
    },
  ],
});
