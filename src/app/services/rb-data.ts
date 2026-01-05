import { Injectable } from '@angular/core';
import {
  Firestore,
  collectionData,
  collection,
  doc,
  docData,
  setDoc,
  updateDoc,
} from '@angular/fire/firestore';
import { Timestamp } from 'firebase/firestore';
import { Observable, forkJoin, map, of, switchMap, take, throwError } from 'rxjs';
const BLADE_IMG = "https://wikisite11.mw2.wiki/icon64/etc_sword_body_i00.png";
const HEAD_IMG = "https://wikisite11.mw2.wiki/icon64/etc_squares_gray_i00.png";
const SHAFT_IMG = "https://masterwork.wiki/icon64/etc_branch_gold_i00.png";
const PART_IMG = "https://wikisite11.mw2.wiki/icon64/etc_plate_silver_i00.png";
const DESIGN_IMG = "https://masterwork.wiki/icon64/etc_pouch_brown_i00.png";
const MATERIAL_IMG = "https://masterwork.wiki/icon64/etc_leather_gray_i00.png";
const PATTERN_IMG = "https://masterwork.wiki/icon64/etc_letter_red_i00.png";
const HELMET_IMG = "https://masterwork.wiki/icon64/armor_leather_helmet_i00.png";
const HELMET2_IMG = "https://masterwork.wiki/icon64/armor_helmet_i00.png";
const TEMPER_IMG = "https://masterwork.wiki/icon64/etc_lump_white_i00.png";
const JEW_GEM_IMG = "https://masterwork.wiki/icon64/etc_crystal_ball_gold_i00.png"
const JEW_WIRE_IMG = "https://masterwork.wiki/icon64/etc_jewel_box_i00.png";
const BO_RING_GEM_IMG = "https://masterwork.wiki/icon64/etc_gem_black_i00.png"
const EAR_PC_IMG = "https://masterwork.wiki/icon64/etc_broken_crystal_silver_i00.png"
const CHAIN_IMG = "https://masterwork.wiki/icon64/etc_jewel_box_i00.png"
const lootMap = {
  "arthroNail": { displayName: "Unidentified Arthro Nail", imgUrl: "https://wikisite11.mw2.wiki/icon64/weapon_arthro_nail_i00.png", name: "arthroNail" },
  "greatAxe": { displayName: "Unidentified Great Axe", imgUrl: "https://masterwork.wiki/icon64/weapon_great_axe_i00.png", name: "greatAxe" },
  "arthroNailpc": { displayName: "Arthro Nail Blade", imgUrl: BLADE_IMG, name: "arthroNail-pc" },
  "greatAxepc": { displayName: "Great Axe Head", imgUrl: HEAD_IMG, name: "greatAxe-pc" },
  "aoba": { displayName: "Art of Battle Axe", imgUrl: "https://masterwork.wiki/icon64/weapon_art_of_battle_axe_i00.png", name: "aoba" },
  "aobapc": { displayName: "Art of Battle Axe Blade", imgUrl: BLADE_IMG, name: "aoba-pc" },
  "bellion": { displayName: "Bellion Cestus", imgUrl: "https://masterwork.wiki/icon64/weapon_bellion_cestus_i00.png", name: "bellion" },
  "bellionpc": { displayName: "Bellion Cestus Edge", imgUrl: BLADE_IMG, name: "bellion-pc" },
  "bones": { displayName: "Kaim Vanul's Bones", imgUrl: "https://masterwork.wiki/icon64/weapon_bone_of_kaim_vanul_i00.png", name: "bones" },
  "bonespc": { displayName: "Bones Head of Kaim Vanul", imgUrl: HEAD_IMG, name: "bones-pc" },
  "bop": { displayName: "Bow of Peril", imgUrl: "https://masterwork.wiki/icon64/weapon_hazard_bow_i00.png", name: "bop" },
  "boppc": { displayName: "Bow of Peril Shaft", imgUrl: SHAFT_IMG, name: "bop-pc" },
  "damascus": { displayName: "Sword of Damascus", imgUrl: "https://masterwork.wiki/icon64/weapon_sword_of_damascus_i00.png", name: "damascus" },
  "damascuspc": { displayName: "Sword of Damascus Blade", imgUrl: BLADE_IMG, name: "damascus-pc" },
  "darkBow": { displayName: "Dark Elven Long Bow", imgUrl: "https://masterwork.wiki/icon64/weapon_dark_elven_long_bow_i00.png", name: "darkBow" },
  "darkBowpc": { displayName: "Dark Elven Long Bow Shaft", imgUrl: SHAFT_IMG, name: "darkBow-pc" },
  "deadman": { displayName: "Deadman's Glory", imgUrl: "https://masterwork.wiki/icon64/weapon_deadmans_glory_i00.png", name: "deadman" },
  "deadmanpc": { displayName: "Deadman's Glory Stone", imgUrl: HEAD_IMG, name: "deadman-pc" },
  "demon": { displayName: "Demon's Dagger", imgUrl: "https://masterwork.wiki/icon64/weapon_demons_sword_i00.png", name: "demon" },
  "demonpc": { displayName: "Demon's Dagger Blade", imgUrl: BLADE_IMG, name: "demon-pc" },
  "greatSword": { displayName: "Great Sword", imgUrl: "https://masterwork.wiki/icon64/weapon_great_sword_i00.png", name: "greatSword" },
  "greatSwordpc": { displayName: "Great Sword Blade", imgUrl: BLADE_IMG, name: "greatSword-pc" },
  "guardian": { displayName: "Guardian Sword", imgUrl: "https://masterwork.wiki/icon64/weapon_guardians_sword_i00.png", name: "guardian" },
  "guardianpc": { displayName: "Guardian Sword Blade", imgUrl: BLADE_IMG, name: "guardian-pc" },
  "heavyWarAxe": { displayName: "Heavy War Axe", imgUrl: "https://masterwork.wiki/icon64/weapon_heavy_war_axe_i00.png", name: "heavyWarAxe" },
  "heavyWarAxepc": { displayName: "Heavy War Axe Head", imgUrl: HEAD_IMG, name: "heavyWarAxe-pc" },
  "hellKnife": { displayName: "Hell Knife", imgUrl: "https://masterwork.wiki/icon64/weapon_hell_knife_i00.png", name: "hellKnife" },
  "hellKnifepc": { displayName: "Hell Knife Edge", imgUrl: BLADE_IMG, name: "hellKnife-pc" },
  "ice": { displayName: "Ice Storm Hammer", imgUrl: "https://masterwork.wiki/icon64/weapon_ice_storm_hammer_i00.png", name: "ice" },
  "icepc": { displayName: "Ice Storm Hammer Head", imgUrl: HEAD_IMG, name: "ice-pc" },
  "kesh": { displayName: "Keshanberk", imgUrl: "https://masterwork.wiki/icon64/weapon_kshanberk_i00.png", name: "kesh" },
  "keshpc": { displayName: "Keshanberk Blade", imgUrl: BLADE_IMG, name: "kesh-pc" },
  "kris": { displayName: "Kris", imgUrl: "https://masterwork.wiki/icon64/weapon_kris_i00.png", name: "kris" },
  "krispc": { displayName: "Kris Blade", imgUrl: BLADE_IMG, name: "kris-pc" },
  "lance": { displayName: "Lance", imgUrl: "https://masterwork.wiki/icon64/weapon_lancia_i00.png", name: "lance" },
  "lancepc": { displayName: "Lance Blade", imgUrl: BLADE_IMG, name: "lance-pc" },
  "soes": { displayName: "Staff of Evil Spirits", imgUrl: "https://masterwork.wiki/icon64/weapon_staff_of_evil_sprit_i00.png", name: "soes" },
  "soespc": { displayName: "Staff of Evil Spirits", imgUrl: HEAD_IMG, name: "soes-pc" },
  "spell": { displayName: "Spell Breaker", imgUrl: "https://masterwork.wiki/icon64/weapon_spell_breaker_i00.png", name: "spell" },
  "spellpc": { displayName: "Spell Breaker Head", imgUrl: HEAD_IMG, name: "spell-pc" },
  "sprite": { displayName: "Sprite's Staff", imgUrl: "https://masterwork.wiki/icon64/weapon_sprites_staff_i00.png", name: "sprite" },
  "spritepc": { displayName: "Sprite's Staff Head", imgUrl: HEAD_IMG, name: "sprite-pc" },
  "starBuster": { displayName: "Star Buster", imgUrl: "https://masterwork.wiki/icon64/weapon_star_buster_i00.png", name: "starBuster" },
  "starBusterpc": { displayName: "Star Buster Head", imgUrl: HEAD_IMG, name: "starBuster-pc" },
  "valhalla": { displayName: "Sword of Valhalla", imgUrl: "https://masterwork.wiki/icon64/weapon_sword_of_valhalla_i00.png", name: "valhalla" },
  "valhallapc": { displayName: "Sword of Valhalla Blade", imgUrl: BLADE_IMG, name: "valhalla-pc" },
  "wizard": { displayName: "Wizard's Tear", imgUrl: "https://masterwork.wiki/icon64/weapon_tears_of_wizard_i00.png", name: "wizard" },
  "wizardpc": { displayName: "Wizard's Tear Blade", imgUrl: BLADE_IMG, name: "wizard-pc" },
  "avaGloves": { displayName: "Unidentified Sealed Avadon Gloves", imgUrl: "https://masterwork.wiki/icon64/armor_t66_g_i02.png", name: "avaGloves" },
  "avaGlovespc": { displayName: "Sealed Avadon Gloves Part", imgUrl: PART_IMG, name: "avaGloves-pc" },
  "avaBoots": { displayName: "Unidentified Sealed Avadon Boots", imgUrl: "https://masterwork.wiki/icon64/armor_t66_b_i02.png", name: "avaBoots" },
  "avaBootspc": { displayName: "Sealed Avadon Boots Design", imgUrl: DESIGN_IMG, name: "avaBoots-pc" },
  "zubGloves": { displayName: "Unidentified Sealed Zubei's Gauntlets", imgUrl: "https://masterwork.wiki/icon64/armor_t64_g_i02.png", name: "zubGloves" },
  "zubGlovespc": { displayName: "Sealed Zubei's Gauntlets Part", imgUrl: PART_IMG, name: "zubGloves-pc" },
  "zubBoots": { displayName: "Unidentified Sealed Zubei's Boots", imgUrl: "https://masterwork.wiki/icon64/armor_t64_b_i02.png", name: "zubBoots" },
  "zubBootspc": { displayName: "Sealed Zubei's Boots Design", imgUrl: DESIGN_IMG, name: "zubBoots-pc" },
  "avaBreast": { displayName: "Avadon Breastplate", imgUrl: "https://masterwork.wiki/icon64/armor_t66_u_i00.png", name: "avaBreast" },
  "avaBreastpc": { displayName: "Avadon Breastplate Part", imgUrl: PART_IMG, name: "avaBreast-pc" },
  "avaGaiter": { displayName: "Avadon Gaiters", imgUrl: "https://masterwork.wiki/icon64/armor_t66_l_i00.png", name: "avaGaiter" },
  "avaGaiterpc": { displayName: "Avadon Gaiters Material", imgUrl: MATERIAL_IMG, name: "avaGaiter-pc" },
  "avaHelm": { displayName: "Avadon Circlet", imgUrl: HELMET_IMG, name: "avaHelm" },
  "avaHelmpc": { displayName: "Avadon Circlet Pattern", imgUrl: PATTERN_IMG, name: "avaHelm-pc" },
  "avaLeath": { displayName: "Avadon Leather Armor", imgUrl: "https://masterwork.wiki/icon64/armor_t67_ul_i00.png", name: "avaLeath" },
  "avaLeathpc": { displayName: "Avadon Leather Armor Material", imgUrl: MATERIAL_IMG, name: "avaLeath-pc" },
  "avaRobe": { displayName: "Avadon Robe", imgUrl: "https://masterwork.wiki/icon64/armor_t59_ul_i00.png", name: "avaRobe" },
  "avaRobepc": { displayName: "Avadon Robe Fabric", imgUrl: MATERIAL_IMG, name: "avaRobe-pc" },
  "avaShield": { displayName: "Avadon Shield", imgUrl: "https://masterwork.wiki/icon64/shield_avadon_shield_i00.png", name: "avaShield" },
  "avaShieldpc": { displayName: "Avadon Shield Fragment", imgUrl: PART_IMG, name: "avaShield-pc" },
  "bwBoots": { displayName: "Sealed Blue Wolf Boots", imgUrl: "https://masterwork.wiki/icon64/armor_t68_b_i02.png", name: "bwBoots" },
  "bwBootspc": { displayName: "Sealed Blue Wolf Boots", imgUrl: DESIGN_IMG, name: "bwBoots-pc" },
  "bwBreast": { displayName: "Blue Wolf Breastplate", imgUrl: "https://masterwork.wiki/icon64/armor_t68_u_i00.png", name: "bwBreast" },
  "bwBreastpc": { displayName: "Blue Wolf Breastplate Part", imgUrl: PART_IMG, name: "bwBreast-pc" },
  "bwGaiter": { displayName: "Blue Wolf Gaiters", imgUrl: "https://masterwork.wiki/icon64/armor_t68_l_i00.png", name: "bwGaiter" },
  "bwGaiterpc": { displayName: "Blue Wolf Gaiters Material", imgUrl: MATERIAL_IMG, name: "bwGaiter-pc" },
  "bwGloves": { displayName: "Sealed Blue Wolf Gloves", imgUrl: "https://masterwork.wiki/icon64/armor_t68_g_i02.png", name: "bwGloves" },
  "bwGlovespc": { displayName: "Sealed Blue Wolf Gloves Fabric", imgUrl: MATERIAL_IMG, name: "bwGloves-pc" },
  "bwHelm": { displayName: "Blue Wolf Helmet", imgUrl: HELMET_IMG, name: "bwHelm" },
  "bwHelmpc": { displayName: "Blue Wolf Helmet Design", imgUrl: DESIGN_IMG, name: "bwHelm-pc" },
  "bwLeather": { displayName: "Blue Wolf Leather Armor", imgUrl: "https://masterwork.wiki/icon64/armor_t69_ul_i00.png", name: "bwLeather" },
  "bwLeatherpc": { displayName: "Blue Wolf Leather Armor Texture", imgUrl: MATERIAL_IMG, name: "bwLeather-pc" },
  "bwStoc": { displayName: "Blue Wolf Stockings", imgUrl: "https://masterwork.wiki/icon64/armor_t70_l_i00.png", name: "bwStoc" },
  "bwStocpc": { displayName: "Blue Wolf Stockingsc Pattern", imgUrl: PATTERN_IMG, name: "bwStoc-pc" },
  "bwTunic": { displayName: "Blue Wolf Tunic", imgUrl: "https://masterwork.wiki/icon64/armor_t70_u_i00.png", name: "bwTunic" },
  "bwTunicpc": { displayName: "Blue Wolf Tunic Fabric", imgUrl: MATERIAL_IMG, name: "bwTunic-pc" },
  "doomBoots": { displayName: "Sealed Doom Boots", imgUrl: "https://masterwork.wiki/icon64/armor_t71_b_i02.png", name: "doomBoots" },
  "doomBootspc": { displayName: "Sealed Doom Boots Part", imgUrl: PART_IMG, name: "doomBoots-pc" },
  "doomGloves": { displayName: "Sealed Doom Gloves", imgUrl: "https://masterwork.wiki/icon64/armor_t71_g_i02.png", name: "doomGloves" },
  "doomGlovespc": { displayName: "Sealed Doom Gloves Part", imgUrl: PART_IMG, name: "doomGloves-pc" },
  "doomHelm": { displayName: "Doom Helmet", imgUrl: HELMET_IMG, name: "doomHelm" },
  "doomHelmpc": { displayName: "Doom Helmet Pattern", imgUrl: PATTERN_IMG, name: "doomHelm-pc" },
  "doomLeath": { displayName: "Leather Armor of Doom", imgUrl: "https://masterwork.wiki/icon64/armor_t72_ul_i00.png", name: "doomLeath" },
  "doomLeathpc": { displayName: "Leather Armor of Doom Design", imgUrl: DESIGN_IMG, name: "doomLeath-pc" },
  "doomPlate": { displayName: "Doom Plate Armor", imgUrl: "https://masterwork.wiki/icon64/armor_t71_ul_i00.png", name: "doomPlate" },
  "doomPlatepc": { displayName: "Doom Plate Armor Temper", imgUrl: TEMPER_IMG, name: "doomPlate-pc" },
  "doomShield": { displayName: "Doom Shield", imgUrl: "https://masterwork.wiki/icon64/shield_doom_shield_i00.png", name: "doomShield" },
  "doomShieldpc": { displayName: "Doom Shield Fragment", imgUrl: PART_IMG, name: "doomShield-pc" },
  "doomStoc": { displayName: "Stockings of Doom", imgUrl: "https://masterwork.wiki/icon64/armor_t73_l_i00.png", name: "doomStoc" },
  "doomStocpc": { displayName: "Stockings of Doom Pattern", imgUrl: PATTERN_IMG, name: "doomStoc-pc" },
  "doomTunic": { displayName: "Tunic of Doom", imgUrl: "https://masterwork.wiki/icon64/armor_t73_u_i00.png", name: "doomTunic" },
  "doomTunicpc": { displayName: "Tunic of Doom Pattern", imgUrl: PATTERN_IMG, name: "doomTunic-pc" },
  "zubBreast": { displayName: "Zubei's Breastplate", imgUrl: "https://masterwork.wiki/icon64/armor_t64_u_i00.png", name: "zubBreast" },
  "zubBreastpc": { displayName: "Zubei's Breastplate Part", imgUrl: PART_IMG, name: "zubBreast-pc" },
  "zubGaiter": { displayName: "Zubei's Gaiters", imgUrl: "https://masterwork.wiki/icon64/armor_t64_l_i00.png", name: "zubGaiter" },
  "zubGaiterpc": { displayName: "Zubei's Gaiters Material", imgUrl: MATERIAL_IMG, name: "zubGaiter-pc" },
  "zubHelm": { displayName: "Zubei's Helmet", imgUrl: HELMET2_IMG, name: "zubHelm" },
  "zubHelmpc": { displayName: "Zubei's Helmet Design", imgUrl: DESIGN_IMG, name: "zubHelm-pc" },
  "zubLeathS": { displayName: "Zubei's Leather Shirt", imgUrl: "https://masterwork.wiki/icon64/armor_t65_u_i00.png", name: "zubLeathG" },
  "zubLeathSpc": { displayName: "Zubei's Leather Shirt Fabric", imgUrl: MATERIAL_IMG, name: "zubLeathG-pc" },
  "zubLeathG": { displayName: "Zubei's Leather Gaiters", imgUrl: "https://masterwork.wiki/icon64/armor_t65_l_i00.png", name: "zubLeathS" },
  "zubLeathGpc": { displayName: "Zubei's Leather Gaiters Texture", imgUrl: MATERIAL_IMG, name: "zubLeathS-pc" },
  "zubShield": { displayName: "Zubei's Shield", imgUrl: "https://masterwork.wiki/icon64/shield_shrnoens_shield_i00.png", name: "zubShield" },
  "zubShieldpc": { displayName: "Zubei's Shield Fragment", imgUrl: PART_IMG, name: "zubShield-pc" },
  "zubStoc": { displayName: "Stockings of Zubei", imgUrl: "https://masterwork.wiki/icon64/armor_t56_l_i00.png", name: "zubStoc" },
  "zubStocpc": { displayName: "Stockings of Zubei Fabric", imgUrl: MATERIAL_IMG, name: "zubStoc-pc" },
  "zubTunic": { displayName: "Tunic of Zubei", imgUrl: "https://masterwork.wiki/icon64/armor_t56_u_i00.png", name: "zubTunic" },
  "zubTunicpc": { displayName: "Tunic of Zubei Fabric", imgUrl: MATERIAL_IMG, name: "zubTunic-pc" },
  "adRing": { displayName: "Adamantite Ring", imgUrl: "https://masterwork.wiki/icon64/accessary_adamantite_ring_i00.png", name: "adRing" },
  "adRingpc": { displayName: "Adamantite Ring Wire", imgUrl: JEW_WIRE_IMG, name: "adRing-pc" },
  "adEarring": { displayName: "Adamantite Earring", imgUrl: "https://masterwork.wiki/icon64/accessary_adamantite_earing_i00.png", name: "adEarring" },
  "adEarringpc": { displayName: "Adamantite Earring Gemstone", imgUrl: JEW_GEM_IMG, name: "adEarring-pc" },
  "adNecklace": { displayName: "Adamantite Necklace", imgUrl: "https://masterwork.wiki/icon64/accessary_adamantite_necklace_i00.png", name: "adNecklace" },
  "adNecklacepc": { displayName: "Adamantite Necklace Chain", imgUrl: CHAIN_IMG, name: "adNecklace-pc" },
  "boRing": { displayName: "Ring of Black Ore", imgUrl: "https://masterwork.wiki/icon64/accessary_ring_of_black_ore_i00.png", name: "boRing" },
  "boRingpc": { displayName: "Ring of Black Ore Gemstone", imgUrl: BO_RING_GEM_IMG, name: "boRing-pc" },
  "boEarring": { displayName: "Earring of Black Ore", imgUrl: "https://masterwork.wiki/icon64/accessary_earing_of_black_ore_i00.png", name: "boEarring" },
  "boEarringpc": { displayName: "Earring of Black Ore Gemstone", imgUrl: EAR_PC_IMG, name: "boEarring-pc" },
  "boNecklace": { displayName: "Necklace of Black Ore", imgUrl: "https://masterwork.wiki/icon64/accessary_necklace_of_black_ore_i00.png", name: "boNecklace" },
  "boNecklacepc": { displayName: "Necklace of Black Ore Beads", imgUrl: EAR_PC_IMG, name: "boNecklace-pc" },
  "eac": { displayName: "Scroll: Enchant Armor (C-Grade)", imgUrl: "https://masterwork.wiki/icon64/etc_scroll_of_enchant_armor_i02.png", name: "eac" },
  "beac": { displayName: "Blessed Scroll: Enchant Armor (C-Grade)", imgUrl: "https://masterwork.wiki/icon64/etc_blessed_scrl_of_ench_am_c_i02.png", name: "beac" },
  "ewc": { displayName: "Scroll: Enchant Weapon (C-Grade)", imgUrl: "https://masterwork.wiki/icon64/etc_scroll_of_enchant_weapon_i02.png", name: "ewc" },
  "bewc": { displayName: "Blessed Scroll: Enchant Weapon (C-Grade)", imgUrl: "https://masterwork.wiki/icon64/etc_blessed_scrl_of_ench_wp_c_i02.png", name: "bewc" },
  "eab": { displayName: "Scroll: Enchant Armor (B-Grade)", imgUrl: "https://masterwork.wiki/icon64/etc_scroll_of_enchant_armor_i03.png", name: "eab" },
  "beab": { displayName: "Blessed Scroll: Enchant Armor (B-Grade)", imgUrl: "https://masterwork.wiki/icon64/etc_blessed_scrl_of_ench_am_b_i03.png", name: "beab" },
  "ewb": { displayName: "Scroll: Enchant Weapon (B-Grade)", imgUrl: "https://masterwork.wiki/icon64/etc_scroll_of_enchant_weapon_i03.png", name: "ewb" },
  "bewb": { displayName: "Blessed Scroll: Enchant Weapon (B-Grade)", imgUrl: "https://masterwork.wiki/icon64/etc_blessed_scrl_of_ench_wp_b_i03.png", name: "bewb" },
};

const EnchantsLoot = [
  lootMap.eac,
  lootMap.beac,
  lootMap.ewc,
  lootMap.bewc,
  lootMap.eab,
  lootMap.beab,
  lootMap.ewb,
  lootMap.bewb
]

const RB_DATA = [
  {
    name: "[52] Fafurion's Envoy Pingolpin [GoE]",
    loot: [
      lootMap.arthroNail,
      lootMap.greatAxe,
      lootMap.arthroNailpc,
      lootMap.greatAxepc,
      lootMap.avaGloves,
      lootMap.zubGloves,
      lootMap.avaBoots,
      lootMap.zubBoots,
      lootMap.avaGlovespc,
      lootMap.zubGlovespc,
      lootMap.avaBootspc,
      lootMap.zubBootspc,
      ...EnchantsLoot
    ],
    meta: {
      imageUrl: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ8dYsdcBzTm4OZjWKNF7-MUrX3TwSR7qG08g&s',
      infoLink: 'https://wikisite11.mw2.wiki/npc/25496-fafurions-envoy-pingolpin/lu4'
    }
  },
  {
    name: "[52] Captain of Red Flag Shaka [Outlaw]",
    loot: [
      lootMap.kesh,
      lootMap.greatSword,
      lootMap.valhalla,
      lootMap.keshpc,
      lootMap.greatSwordpc,
      lootMap.valhallapc,
      lootMap.adNecklace,
      lootMap.adEarring,
      lootMap.adRing,
      lootMap.adNecklacepc,
      lootMap.adEarringpc,
      lootMap.adRingpc,
      ...EnchantsLoot
    ],
    meta: {
      imageUrl: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ8dYsdcBzTm4OZjWKNF7-MUrX3TwSR7qG08g&s',
      infoLink: 'https://wikisite11.mw2.wiki/npc/25067-captain-of-red-flag-shaka/lu4'
    }
  },
  {
    name: "[53] Magus Kenishee [DI]",
    loot: [
      lootMap.kris,
      lootMap.hellKnife,
      lootMap.darkBow,
      lootMap.krispc,
      lootMap.hellKnifepc,
      lootMap.darkBowpc,
      lootMap.avaLeath,
      lootMap.zubLeathS,
      lootMap.zubLeathG,
      lootMap.avaLeathpc,
      lootMap.zubLeathSpc,
      lootMap.zubLeathGpc,
      ...EnchantsLoot
    ],
    meta: {
      imageUrl: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ8dYsdcBzTm4OZjWKNF7-MUrX3TwSR7qG08g&s',
      infoLink: 'https://wikisite11.mw2.wiki/npc/25481-magus-kenishee/lu4'
    }
  },
  {
    name: "[53] Atraiban [DI]",
    loot: [
      lootMap.kris,
      lootMap.hellKnife,
      lootMap.darkBow,
      lootMap.krispc,
      lootMap.hellKnifepc,
      lootMap.darkBowpc,
      lootMap.avaHelm,
      lootMap.zubHelm,
      lootMap.avaShield,
      lootMap.zubShield,
      lootMap.avaHelmpc,
      lootMap.zubHelmpc,
      lootMap.avaShieldpc,
      lootMap.zubShieldpc,
      ...EnchantsLoot
    ],
    meta: {
      imageUrl: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ8dYsdcBzTm4OZjWKNF7-MUrX3TwSR7qG08g&s',
      infoLink: 'https://wikisite11.mw2.wiki/npc/25029-atraiban/lu4'
    }
  },
  {
    name: "[54] Paniel the Unicorn [EV 650]",
    loot: [
      lootMap.heavyWarAxe,
      lootMap.ice,
      lootMap.spell,
      lootMap.sprite,
      lootMap.heavyWarAxepc,
      lootMap.icepc,
      lootMap.spellpc,
      lootMap.spritepc,
      lootMap.avaBreast,
      lootMap.zubBreast,
      lootMap.avaGaiter,
      lootMap.zubGaiter,
      lootMap.avaBreastpc,
      lootMap.zubBreastpc,
      lootMap.avaGaiterpc,
      lootMap.zubGaiterpc,
      ...EnchantsLoot
    ],
    meta: {
      imageUrl: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ8dYsdcBzTm4OZjWKNF7-MUrX3TwSR7qG08g&s',
      infoLink: 'https://wikisite11.mw2.wiki/npc/25159-paniel-the-unicorn/lu4'
    }
  },
  {
    name: "[55] Beleth's Seer, Sephia [HA]",
    loot: [
      lootMap.arthroNail,
      lootMap.greatAxe,
      lootMap.arthroNailpc,
      lootMap.greatAxepc,
      lootMap.avaHelm,
      lootMap.zubHelm,
      lootMap.avaShield,
      lootMap.zubShield,
      lootMap.avaHelmpc,
      lootMap.zubHelmpc,
      lootMap.avaShieldpc,
      lootMap.zubShieldpc,
      ...EnchantsLoot
    ],
    meta: {
      imageUrl: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ8dYsdcBzTm4OZjWKNF7-MUrX3TwSR7qG08g&s',
      infoLink: 'https://wikisite11.mw2.wiki/npc/25137-beleths-seer-sephia/lu4'
    }
  },
  {
    name: "[55] Bandit Leader Barda [Outlaw]",
    loot: [
      lootMap.kesh,
      lootMap.greatSword,
      lootMap.valhalla,
      lootMap.keshpc,
      lootMap.greatSwordpc,
      lootMap.valhallapc,
      lootMap.avaGloves,
      lootMap.zubGloves,
      lootMap.avaBoots,
      lootMap.zubBoots,
      lootMap.avaGlovespc,
      lootMap.zubGlovespc,
      lootMap.avaBootspc,
      lootMap.zubBootspc,
      ...EnchantsLoot
    ],
    meta: {
      imageUrl: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ8dYsdcBzTm4OZjWKNF7-MUrX3TwSR7qG08g&s',
      infoLink: 'https://wikisite11.mw2.wiki/npc/25434-bandit-leader-barda/lu4'
    }
  },
  {
    name: "[55] Black Lily [DV]",
    loot: [
      lootMap.kris,
      lootMap.hellKnife,
      lootMap.darkBow,
      lootMap.krispc,
      lootMap.hellKnifepc,
      lootMap.darkBowpc,
      lootMap.avaLeath,
      lootMap.zubLeathS,
      lootMap.zubLeathG,
      lootMap.avaLeathpc,
      lootMap.zubLeathSpc,
      lootMap.zubLeathGpc,
      ...EnchantsLoot
    ],
    meta: {
      imageUrl: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ8dYsdcBzTm4OZjWKNF7-MUrX3TwSR7qG08g&s',
      infoLink: 'https://wikisite11.mw2.wiki/npc/25176-black-lily/lu4'
    }
  },
  {
    name: "[55] Eva's Spirit Niniel [GoE]",
    loot: [
      lootMap.heavyWarAxe,
      lootMap.ice,
      lootMap.spell,
      lootMap.sprite,
      lootMap.heavyWarAxepc,
      lootMap.icepc,
      lootMap.spellpc,
      lootMap.spritepc,
      lootMap.adNecklace,
      lootMap.adEarring,
      lootMap.adRing,
      lootMap.adNecklacepc,
      lootMap.adEarringpc,
      lootMap.adRingpc,
      ...EnchantsLoot
    ],
    meta: {
      imageUrl: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ8dYsdcBzTm4OZjWKNF7-MUrX3TwSR7qG08g&s',
      infoLink: 'https://wikisite11.mw2.wiki/npc/25493-evas-spirit-niniel/lu4'
    }
  },
  {
    name: "[55] Harit Hero Tamash [FoM]",
    loot: [
      lootMap.kris,
      lootMap.hellKnife,
      lootMap.darkBow,
      lootMap.krispc,
      lootMap.hellKnifepc,
      lootMap.darkBowpc,
      lootMap.avaBreast,
      lootMap.zubBreast,
      lootMap.avaGaiter,
      lootMap.zubGaiter,
      lootMap.avaBreastpc,
      lootMap.zubBreastpc,
      lootMap.avaGaiterpc,
      lootMap.zubGaiterpc,
      ...EnchantsLoot
    ],
    meta: {
      imageUrl: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ8dYsdcBzTm4OZjWKNF7-MUrX3TwSR7qG08g&s',
      infoLink: 'https://wikisite11.mw2.wiki/npc/25241-harit-hero-tamash/lu4'
    }
  },
  {
    name: "[55] Zaken's Butcher Krantz [DI]",
    loot: [
      lootMap.heavyWarAxe,
      lootMap.ice,
      lootMap.spell,
      lootMap.sprite,
      lootMap.heavyWarAxepc,
      lootMap.icepc,
      lootMap.spellpc,
      lootMap.spritepc,
      lootMap.avaRobe,
      lootMap.zubTunic,
      lootMap.zubStoc,
      lootMap.avaRobepc,
      lootMap.zubTunicpc,
      lootMap.zubStocpc,
      ...EnchantsLoot
    ],
    meta: {
      imageUrl: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ8dYsdcBzTm4OZjWKNF7-MUrX3TwSR7qG08g&s',
      infoLink: 'https://wikisite11.mw2.wiki/npc/25259-zakens-butcher-krantz/lu4'
    }
  },
  {
    name: "[55] Furious Thieles [EV]",
    loot: [
      lootMap.arthroNail,
      lootMap.greatAxe,
      lootMap.arthroNailpc,
      lootMap.greatAxepc,
      lootMap.avaRobe,
      lootMap.zubTunic,
      lootMap.zubStoc,
      lootMap.avaRobepc,
      lootMap.zubTunicpc,
      lootMap.zubStocpc,
      ...EnchantsLoot
    ],
    meta: {
      imageUrl: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ8dYsdcBzTm4OZjWKNF7-MUrX3TwSR7qG08g&s',
      infoLink: 'https://wikisite11.mw2.wiki/npc/25010-furious-thieles/lu4'
    }
  },
  {
    name: "[55] Enchanted Forest Watcher Ruell [EV 650]",
    loot: [
      lootMap.kesh,
      lootMap.greatSword,
      lootMap.valhalla,
      lootMap.keshpc,
      lootMap.greatSwordpc,
      lootMap.valhallapc,
      lootMap.adNecklace,
      lootMap.adEarring,
      lootMap.adRing,
      lootMap.adNecklacepc,
      lootMap.adEarringpc,
      lootMap.adRingpc,
      ...EnchantsLoot
    ],
    meta: {
      imageUrl: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ8dYsdcBzTm4OZjWKNF7-MUrX3TwSR7qG08g&s',
      infoLink: 'https://wikisite11.mw2.wiki/npc/25070-enchanted-forest-watcher-ruell/lu4'
    }
  },
  {
    name: "[55] Sorcerer Isirr [FoM]",
    loot: [
      lootMap.heavyWarAxe,
      lootMap.ice,
      lootMap.spell,
      lootMap.sprite,
      lootMap.heavyWarAxepc,
      lootMap.icepc,
      lootMap.spellpc,
      lootMap.spritepc,
      lootMap.avaGloves,
      lootMap.zubGloves,
      lootMap.avaBoots,
      lootMap.zubBoots,
      lootMap.avaGlovespc,
      lootMap.zubGlovespc,
      lootMap.avaBootspc,
      lootMap.zubBootspc,
      ...EnchantsLoot
    ],
    meta: {
      imageUrl: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ8dYsdcBzTm4OZjWKNF7-MUrX3TwSR7qG08g&s',
      infoLink: 'https://wikisite11.mw2.wiki/npc/25103-sorcerer-isirr/lu4'
    }
  },
  {
    name: "[56] Refugee Applicant Leo [Outlaw]",
    loot: [
      lootMap.bellion,
      lootMap.lance,
      lootMap.bellionpc,
      lootMap.lancepc,
      lootMap.doomLeath,
      lootMap.bwLeather,
      lootMap.doomLeathpc,
      lootMap.bwLeatherpc,
      ...EnchantsLoot
    ],
    meta: {
      imageUrl: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ8dYsdcBzTm4OZjWKNF7-MUrX3TwSR7qG08g&s',
      infoLink: 'https://wikisite11.mw2.wiki/npc/25122-refugee-applicant-leo/lu4'
    }
  },
  {
    name: "[56] Harit Guardian Garangky [FoM]",
    loot: [
      lootMap.damascus,
      lootMap.guardian,
      lootMap.wizard,
      lootMap.damascuspc,
      lootMap.guardianpc,
      lootMap.wizardpc,
      lootMap.boNecklace,
      lootMap.boEarring,
      lootMap.boRing,
      lootMap.boNecklacepc,
      lootMap.boEarringpc,
      lootMap.boRingpc,
      ...EnchantsLoot
    ],
    meta: {
      imageUrl: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ8dYsdcBzTm4OZjWKNF7-MUrX3TwSR7qG08g&s',
      infoLink: 'https://wikisite11.mw2.wiki/npc/25463-harit-guardian-garangky/lu4'
    }
  },
  {
    name: "[56] Carnamakos [Cruma]",
    loot: [
      lootMap.demon,
      lootMap.bop,
      lootMap.demonpc,
      lootMap.boppc,
      lootMap.doomPlate,
      lootMap.bwBreast,
      lootMap.bwGaiter,
      lootMap.doomPlatepc,
      lootMap.bwBreastpc,
      lootMap.bwGaiterpc,
      ...EnchantsLoot
    ],
    meta: {
      imageUrl: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ8dYsdcBzTm4OZjWKNF7-MUrX3TwSR7qG08g&s',
      infoLink: 'www.google.com'
    }
  },
  {
    name: "[57] Timak Seer Ragoth [Oren]",
    loot: [
      lootMap.deadman,
      lootMap.aoba,
      lootMap.starBuster,
      lootMap.bones,
      lootMap.soes,
      lootMap.deadmanpc,
      lootMap.aobapc,
      lootMap.starBusterpc,
      lootMap.bonespc,
      lootMap.soespc,
      lootMap.bwGloves,
      lootMap.doomGloves,
      lootMap.bwBoots,
      lootMap.doomBoots,
      lootMap.bwGlovespc,
      lootMap.doomGlovespc,
      lootMap.bwBootspc,
      lootMap.doomBootspc,
      ...EnchantsLoot
    ],
    meta: {
      imageUrl: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ8dYsdcBzTm4OZjWKNF7-MUrX3TwSR7qG08g&s',
      infoLink: 'https://wikisite11.mw2.wiki/npc/25230-timak-seer-ragoth/lu4'
    }
  },
  {
    name: "[59] Soulless Wild Boar [FoM]",
    loot: [
      lootMap.deadman,
      lootMap.aoba,
      lootMap.starBuster,
      lootMap.bones,
      lootMap.soes,
      lootMap.deadmanpc,
      lootMap.aobapc,
      lootMap.starBusterpc,
      lootMap.bonespc,
      lootMap.soespc,
      lootMap.boNecklace,
      lootMap.boEarring,
      lootMap.boRing,
      lootMap.boNecklacepc,
      lootMap.boEarringpc,
      lootMap.boRingpc,
      ...EnchantsLoot
    ],
    meta: {
      imageUrl: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ8dYsdcBzTm4OZjWKNF7-MUrX3TwSR7qG08g&s',
      infoLink: 'https://wikisite11.mw2.wiki/npc/25089-soulless-wild-boar/lu4'
    }
  },
  {
    name: "[60] Lord Ishka [LOA]",
    loot: [
      lootMap.damascus,
      lootMap.guardian,
      lootMap.wizard,
      lootMap.damascuspc,
      lootMap.guardianpc,
      lootMap.wizardpc,
      lootMap.bwHelm,
      lootMap.doomHelm,
      lootMap.doomShield,
      lootMap.bwHelmpc,
      lootMap.doomHelmpc,
      lootMap.doomShieldpc,
      ...EnchantsLoot
    ],
    meta: {
      imageUrl: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ8dYsdcBzTm4OZjWKNF7-MUrX3TwSR7qG08g&s',
      infoLink: 'www.google.com'
    }
  },
  {
    name: "[60] The 3rd Underwater Guardian [GoE]",
    loot: [
      lootMap.bellion,
      lootMap.lance,
      lootMap.bellionpc,
      lootMap.lancepc,
      lootMap.bwGloves,
      lootMap.doomGloves,
      lootMap.bwBoots,
      lootMap.doomBoots,
      lootMap.bwGlovespc,
      lootMap.doomGlovespc,
      lootMap.bwBootspc,
      lootMap.doomBootspc,
      ...EnchantsLoot
    ],
    meta: {
      imageUrl: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ8dYsdcBzTm4OZjWKNF7-MUrX3TwSR7qG08g&s',
      infoLink: 'https://wikisite11.mw2.wiki/npc/25016-the-3rd-underwater-guardian/lu4'
    }
  },
  {
    name: "[61] Fairy Queen Timiniel [EV]",
    loot: [
      lootMap.demon,
      lootMap.bop,
      lootMap.demonpc,
      lootMap.boppc,
      lootMap.bwTunic,
      lootMap.doomTunic,
      lootMap.bwStoc,
      lootMap.doomStoc,
      lootMap.bwTunicpc,
      lootMap.doomTunicpc,
      lootMap.bwStocpc,
      lootMap.doomStocpc,
      ...EnchantsLoot
    ],
    meta: {
      imageUrl: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ8dYsdcBzTm4OZjWKNF7-MUrX3TwSR7qG08g&s',
      infoLink: 'www.google.com'
    }
  },
];

export interface Item {
  id?: string;
  name: string;
  value: string;
}

@Injectable({
  providedIn: 'root'
})
export class RbData {
  constructor(private firestore: Firestore) {}

  // private safeDocId(value: string): string {
  //   // Firestore doc ids cannot contain '/'
  //   return String(value ?? '').replaceAll('/', '-').trim();
  // }

  // private parseLvl(displayName: string): number | null {
  //   const match = String(displayName ?? '').match(/^\[(\d+)\]/);
  //   if (!match) return null;
  //   const lvl = Number(match[1]);
  //   return Number.isFinite(lvl) ? lvl : null;
  // }

  // // TEMP: seed many loot objects into `possibleLoot` (doc id = `name`).
  // async addLoot(
  //   name: string,
  //   loot: { displayName: string; imgUrl: string }
  // ): Promise<void> {
  //   if (!name) throw new Error('name is required');
  //   const ref = doc(this.firestore, 'possibleLoot', this.safeDocId(name));
  //   await setDoc(ref, { displayName: loot.displayName, imgUrl: loot.imgUrl }, { merge: true });
  // }

  // // TEMP: seed all entries from local lootMap into `possibleLoot`.
  // async seedPossibleLootFromLootMap(): Promise<void> {
  //   const entries = Object.values(lootMap) as Array<{
  //     name: string;
  //     displayName: string;
  //     imgUrl: string;
  //   }>;

  //   for (const entry of entries) {
  //     await this.addLoot(entry.name, {
  //       displayName: entry.displayName,
  //       imgUrl: entry.imgUrl,
  //     });
  //   }
  // }

  // // TEMP: seed RBs into `rb-data`.
  // // - doc id = displayName (sanitized)
  // // - displayName = RB_DATA.name
  // // - lastDeadTime = now
  // // - loot = array of DocumentReferences to /possibleLoot/{name}
  // // - meta = existing meta + respTime/plusMinusRespTime
  // async addRbData(payload: {
  //   displayName: string;
  //   lootRefs: any[];
  //   meta: Record<string, any>;
  // }): Promise<void> {
  //   const displayName = String(payload?.displayName ?? '').trim();
  //   if (!displayName) throw new Error('displayName is required');

  //   const id = this.safeDocId(displayName);
  //   const ref = doc(this.firestore, 'rb-data', id);

  //   const lvl = this.parseLvl(displayName);

  //   await setDoc(
  //     ref,
  //     {
  //       displayName,
  //       lvl,
  //       lastDeadTime: Timestamp.fromDate(new Date()),
  //       loot: payload.lootRefs ?? [],
  //       meta: {
  //         ...(payload.meta ?? {}),
  //         plusMinusRespTime: 4,
  //         respTime: 8,
  //       },
  //     },
  //     { merge: true }
  //   );
  // }

  // // TEMP: seed RB_DATA into `rb-data`.
  // async seedRbDataFromConst(): Promise<void> {
  //   const entries = RB_DATA as Array<any>;

  //   for (const entry of entries) {
  //     const displayName = entry?.name;
  //     const loot = (entry?.loot ?? []) as any[];

  //     const lootRefs = loot
  //       .map((l) => {
  //         const name = typeof l === 'string' ? l : l?.name;
  //         if (!name) return null;
  //         return doc(this.firestore, 'possibleLoot', this.safeDocId(name));
  //       })
  //       .filter(Boolean);

  //     await this.addRbData({
  //       displayName,
  //       lootRefs,
  //       meta: entry?.meta ?? {},
  //     });
  //   }
  // }

  async setKillTime(rbId: string, killTime: Date | null): Promise<void> {
    if (!rbId) {
      throw new Error('rbId is required');
    }

    const ref = doc(this.firestore, 'rb-data', rbId);
    await updateDoc(ref, {
      lastDeadTime: killTime ? Timestamp.fromDate(killTime) : null,
    });
  }

getItems(): Observable<any[]> {
  console.log('Fetching items from Firestore...');
  const entitiesCollection = collection(this.firestore, 'rb-data');

  return collectionData(entitiesCollection, { idField: 'id' }).pipe(
    switchMap((entities: any[]) => {
      if (!entities.length) {
        return of([]);
      }

      const observables = entities.map(entity => {
        if (Array.isArray(entity.loot) && entity.loot.length) {
          const lootObservables = entity.loot.map((ref: any) => {
            if (!ref) return of(null);

            return docData<any>(ref, { idField: 'id' }).pipe(take(1));
          });

          return forkJoin(lootObservables).pipe(
            map((lootData:any) => ({
              ...entity,
              loot: lootData
            }))
          );
        } else {
          return of({ ...entity, loot: [] });
        }
      });

      return forkJoin(observables);
    })
  );
}
}