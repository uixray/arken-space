import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  campaignAudioTracks,
  campaigns,
  catalogEntries,
  characterCatalogEntries,
  characters,
  gmAccessCredentials,
  memberships,
  playerAccessGrants,
  scenes,
  tokenControllers,
  tokenDefinitions,
  tokens,
} from "@arken/db";
import { betaPlayers } from "@arken/contracts";
import { createStarterCharacter } from "@arken/system";
import { env } from "./env.js";
import { hashToken } from "./security.js";
import { defaultThemeForMembership } from "./player-themes.js";

type Database = ReturnType<typeof import("@arken/db").createDatabase>["db"];

export async function reconcileTokenOwnership(db: Database) {
  await db.execute(sql`
    update tokens as token
    set owner_membership_id = character.owner_membership_id,
        updated_at = now()
    from characters as character
    where token.character_id = character.id
      and token.owner_membership_id is distinct from character.owner_membership_id
  `);
}

/**
 * UIX-518: наполнение одной конкретной кампании.
 *
 * Раньше это было частью `ensureSeed`, которая всегда работала с «первой»
 * кампанией. Выделено, чтобы ту же стартовую обстановку можно было создать
 * для отдельной кампании — e2e нужен собственный стол на каждый тест, иначе
 * тесты, меняющие состояние, влияют на соседей.
 *
 * Идемпотентна: каждый кусок добавляется, только если его ещё нет.
 */
export async function seedCampaignContent(
  db: Database,
  campaign: typeof campaigns.$inferSelect,
  gmAccessToken: string,
) {
  await db
    .insert(gmAccessCredentials)
    .values({
      campaignId: campaign.id,
      tokenHash: hashToken(gmAccessToken),
    })
    .onConflictDoNothing();

  let [gm] = await db
    .select()
    .from(memberships)
    .where(eq(memberships.campaignId, campaign.id))
    .limit(1);
  if (!gm) {
    const membershipId = randomUUID();
    [gm] = await db
      .insert(memberships)
      .values({
        id: membershipId,
        campaignId: campaign.id,
        role: "GM",
        displayName: "Мастер",
        defaultThemeId: defaultThemeForMembership(membershipId),
      })
      .returning();
  }

  let [scene] = await db
    .select()
    .from(scenes)
    .where(eq(scenes.campaignId, campaign.id))
    .limit(1);
  if (!scene) {
    [scene] = await db
      .insert(scenes)
      .values({
        campaignId: campaign.id,
        name: "Первая сцена",
        grid: {
          enabled: true,
          size: 64,
          offsetX: 0,
          offsetY: 0,
          color: "#c8b78b",
          opacity: 0.22,
        },
      })
      .returning();
    if (scene)
      await db
        .update(campaigns)
        .set({ activeSceneId: scene.id })
        .where(eq(campaigns.id, campaign.id));
  }

  const [character] = await db
    .select()
    .from(characters)
    .where(eq(characters.campaignId, campaign.id))
    .limit(1);
  if (!character) {
    const starter = createStarterCharacter();
    await db
      .insert(characters)
      .values({ campaignId: campaign.id, name: "Путник", ...starter });
  }

  const [existingTrack] = await db
    .select({ id: campaignAudioTracks.id })
    .from(campaignAudioTracks)
    .where(eq(campaignAudioTracks.campaignId, campaign.id))
    .limit(1);
  if (!existingTrack) {
    await db.insert(campaignAudioTracks).values({ campaignId: campaign.id });
  }

  return { campaign, gm };
}

/** Opt-in fixture for an explicitly local development database only. */
export async function seedDevelopmentDemoContent(
  db: Database,
  campaign: typeof campaigns.$inferSelect,
  scene: typeof scenes.$inferSelect,
  options: { target: "local" },
) {
  if (
    options.target !== "local" ||
    process.env.NODE_ENV !== "development" ||
    process.env.ARKEN_ENABLE_LOCAL_DEMO_SEED !== "1"
  ) {
    throw new Error(
      "Demo seed requires explicit local target, development mode, and ARKEN_ENABLE_LOCAL_DEMO_SEED=1",
    );
  }

  // Общий каталог способностей и навыков кампании
  const demoCatalogDefs = [
    {
      kind: "SKILL" as const,
      name: "Яростный выпад",
      description:
        "Агрессивная атака в ближнем бою с концентрацией на пробитии защиты.",
      data: {
        rollActions: [
          {
            id: "melee-strike",
            label: "Бросок атаки",
            formula: "1d20 + melee",
          },
        ],
      },
    },
    {
      kind: "SKILL" as const,
      name: "Прицельный выстрел",
      description:
        "Выверенный дальний выстрел с поправкой на дистанцию и ветер.",
      data: {
        rollActions: [
          {
            id: "ranged-shot",
            label: "Бросок выстрела",
            formula: "1d20 + ranged",
          },
        ],
      },
    },
    {
      kind: "ABILITY" as const,
      name: "Огненная стрела",
      description:
        "Сгусток концентрированного пламени, наносящий огненный урон.",
      data: {
        rollActions: [
          {
            id: "fire-bolt-roll",
            label: "Урон огнем",
            formula: "2d6 + intelligence",
          },
        ],
        uses: { current: 3, maximum: 3, rechargeRate: "LONG_REST" },
      },
    },
    {
      kind: "ABILITY" as const,
      name: "Малое исцеление",
      description:
        "Прикосновение святого света, восстанавливающее силы раненого соратника.",
      data: {
        rollActions: [
          {
            id: "heal-roll",
            label: "Объем исцеления",
            formula: "1d8 + willpower",
          },
        ],
        uses: { current: 2, maximum: 2, rechargeRate: "SHORT_REST" },
      },
    },
    {
      kind: "ABILITY" as const,
      name: "Теневой шаг",
      description:
        "Мгновенное растворение в сумерках и перемещение на расстояние до 30 футов.",
      data: {
        uses: { current: 2, maximum: 2, rechargeRate: "SHORT_REST" },
      },
    },
    {
      kind: "ABILITY" as const,
      name: "Вдохновение барда",
      description:
        "Слово поддержки или вдохновляющий аккорд, дарующий союзнику кость вдохновения.",
      data: {
        rollActions: [
          { id: "inspire-roll", label: "Бонус вдохновения", formula: "1d6" },
        ],
        uses: { current: 3, maximum: 3, rechargeRate: "SHORT_REST" },
      },
    },
  ];

  const seededCatalog = new Map<string, typeof catalogEntries.$inferSelect>();
  for (const cat of demoCatalogDefs) {
    let [existing] = await db
      .select()
      .from(catalogEntries)
      .where(
        and(
          eq(catalogEntries.campaignId, campaign.id),
          eq(catalogEntries.name, cat.name),
        ),
      )
      .limit(1);
    if (!existing) {
      [existing] = await db
        .insert(catalogEntries)
        .values({
          campaignId: campaign.id,
          kind: cat.kind,
          name: cat.name,
          description: cat.description,
          data: cat.data,
        })
        .returning();
    }
    if (existing) seededCatalog.set(existing.name, existing);
  }

  const betaHeroProfiles: Record<
    string,
    {
      name: string;
      stats: Record<string, number>;
      resources: Record<string, { current: number; maximum: number }>;
      inventory: string[];
      wallet: { gold: number; silver: number; copper: number; sp: number };
      backstory: string;
      notes: string;
      baseColor: string;
      x: number;
      y: number;
      skills: Array<{
        key: string;
        name: string;
        rank: number;
        formula: string;
      }>;
      assignedAbilities: string[];
    }
  > = {
    uixray: {
      name: "Андрей Следопыт",
      stats: {
        strength: 11,
        agility: 15,
        vitality: 13,
        intelligence: 12,
        charisma: 10,
        willpower: 13,
        luck: 14,
        initiative: 4,
        reaction: 3,
        melee: 12,
        ranged: 16,
        enduranceRegen: 3,
        manaRegen: 1,
      },
      resources: {
        physicalPower: { current: 14, maximum: 14 },
        magicPower: { current: 8, maximum: 8 },
      },
      inventory: [
        "Композитный лук следопыта",
        "Колчан эльфийских стрел (30)",
        "Кожаная бригантина",
        "Охотничий кинжал",
        "Веревка 15м",
        "Факел",
        "Фляга с родниковой водой",
      ],
      wallet: { gold: 25, silver: 18, copper: 45, sp: 0 },
      backstory:
        "Опытный следопыт северных лесов. Бесшумно скользит в тенях, точно бьет из длинного лука и знает повадки опаснейших тварей.",
      notes: "Ищет следы древнего культа в предгорьях.",
      baseColor: "#77ad78",
      x: 320,
      y: 320,
      skills: [
        {
          key: "ranged-strike",
          name: "Прицельный выстрел",
          rank: 2,
          formula: "1d20 + ranged",
        },
        {
          key: "melee-strike",
          name: "Удар кинжалом",
          rank: 1,
          formula: "1d20 + agility",
        },
      ],
      assignedAbilities: ["Прицельный выстрел", "Теневой шаг"],
    },
    archinamon: {
      name: "Эдвард Железный Страж",
      stats: {
        strength: 16,
        agility: 10,
        vitality: 16,
        intelligence: 9,
        charisma: 12,
        willpower: 14,
        luck: 10,
        initiative: 1,
        reaction: 1,
        melee: 16,
        ranged: 9,
        enduranceRegen: 4,
        manaRegen: 0,
      },
      resources: {
        physicalPower: { current: 18, maximum: 18 },
        magicPower: { current: 4, maximum: 4 },
      },
      inventory: [
        "Полуторный меч из закаленной стали",
        "Башенный щит с гербом грифона",
        "Латный доспех",
        "Шлем с забралом",
        "Точильный камень",
        "Фляга с элем",
      ],
      wallet: { gold: 18, silver: 42, copper: 20, sp: 0 },
      backstory:
        "Ветеран королевской гвардии. Закован в тяжелые латы, держит строй и принимает на щит сокрушительные удары врагов.",
      notes: "Клятва верности ордену Феникса.",
      baseColor: "#c46f49",
      x: 384,
      y: 320,
      skills: [
        {
          key: "melee-strike",
          name: "Сокрушительный выпад",
          rank: 2,
          formula: "1d20 + melee",
        },
        {
          key: "shield-bash",
          name: "Удар щитом",
          rank: 1,
          formula: "1d20 + strength",
        },
      ],
      assignedAbilities: ["Яростный выпад"],
    },
    DaryaSteel: {
      name: "Дария Алая Волшебница",
      stats: {
        strength: 8,
        agility: 12,
        vitality: 10,
        intelligence: 17,
        charisma: 13,
        willpower: 15,
        luck: 11,
        initiative: 2,
        reaction: 2,
        melee: 8,
        ranged: 12,
        enduranceRegen: 1,
        manaRegen: 4,
      },
      resources: {
        physicalPower: { current: 8, maximum: 8 },
        magicPower: { current: 20, maximum: 20 },
      },
      inventory: [
        "Рунический посох искр",
        "Гримуар Алого Феникса",
        "Шелковая мантия",
        "Флакон с эфирной пылью (3)",
        "Кварцевый фокус",
      ],
      wallet: { gold: 38, silver: 15, copper: 10, sp: 0 },
      backstory:
        "Магистр школы тайного пламени. Изучает рунические гримуары и повелевает первородной стихией огня.",
      notes: "Изучает защитные барьеры древней цивилизации.",
      baseColor: "#d45b5b",
      x: 256,
      y: 384,
      skills: [
        {
          key: "fire-bolt",
          name: "Огненный росчерк",
          rank: 2,
          formula: "1d20 + intelligence",
        },
        {
          key: "arcana-check",
          name: "Тайное знание",
          rank: 2,
          formula: "1d20 + intelligence",
        },
      ],
      assignedAbilities: ["Огненная стрела"],
    },
    IRAKLY123: {
      name: "Ираклий Ночной Клинок",
      stats: {
        strength: 10,
        agility: 17,
        vitality: 11,
        intelligence: 13,
        charisma: 14,
        willpower: 11,
        luck: 16,
        initiative: 5,
        reaction: 4,
        melee: 15,
        ranged: 14,
        enduranceRegen: 3,
        manaRegen: 1,
      },
      resources: {
        physicalPower: { current: 12, maximum: 12 },
        magicPower: { current: 6, maximum: 6 },
      },
      inventory: [
        "Парные кинжалы лунной стали",
        "Набор прецизионных отмычек",
        "Темный маскировочный плащ",
        "Дымовые шашки (3)",
        "Метательные ножи (5)",
      ],
      wallet: { gold: 45, silver: 30, copper: 85, sp: 0 },
      backstory:
        "Мастер скрытных вылазок и неожиданных ударов. Быстр, осторожен и всегда находит брешь в обороне противника.",
      notes: "Связи с подпольной гильдией информаторов.",
      baseColor: "#a67ad4",
      x: 320,
      y: 384,
      skills: [
        {
          key: "sneak-attack",
          name: "Удар из тени",
          rank: 2,
          formula: "1d20 + agility",
        },
        {
          key: "lockpick",
          name: "Взлом замков",
          rank: 2,
          formula: "1d20 + agility",
        },
      ],
      assignedAbilities: ["Теневой шаг", "Яростный выпад"],
    },
    VeePeeK: {
      name: "Алексей Хранитель Света",
      stats: {
        strength: 14,
        agility: 9,
        vitality: 14,
        intelligence: 11,
        charisma: 13,
        willpower: 16,
        luck: 12,
        initiative: 1,
        reaction: 1,
        melee: 14,
        ranged: 8,
        enduranceRegen: 2,
        manaRegen: 3,
      },
      resources: {
        physicalPower: { current: 14, maximum: 14 },
        magicPower: { current: 16, maximum: 16 },
      },
      inventory: [
        "Освященная боевая булава",
        "Кольчужная рубаха",
        "Священный символ Рассвета",
        "Свиток божественной благодати",
        "Фляжка с миррой",
      ],
      wallet: { gold: 20, silver: 35, copper: 15, sp: 0 },
      backstory:
        "Боевой жрец ордена Рассвета. Благословляет соратников, исцеляет смертельные раны и карает нежить сияющей булавой.",
      notes: "Хранит тайну забытого монастыря.",
      baseColor: "#5b82a6",
      x: 384,
      y: 384,
      skills: [
        {
          key: "holy-strike",
          name: "Сияющий удар",
          rank: 2,
          formula: "1d20 + melee",
        },
        {
          key: "prayer",
          name: "Молитва исцеления",
          rank: 2,
          formula: "1d20 + willpower",
        },
      ],
      assignedAbilities: ["Малое исцеление"],
    },
    Zheludock: {
      name: "Михаил Певец Бурь",
      stats: {
        strength: 10,
        agility: 14,
        vitality: 12,
        intelligence: 13,
        charisma: 17,
        willpower: 13,
        luck: 15,
        initiative: 3,
        reaction: 3,
        melee: 13,
        ranged: 11,
        enduranceRegen: 2,
        manaRegen: 2,
      },
      resources: {
        physicalPower: { current: 11, maximum: 11 },
        magicPower: { current: 13, maximum: 13 },
      },
      inventory: [
        "Ренессансная рапира",
        "Резная лютня из вишневого дерева",
        "Шляпа с соколиным пером",
        "Эликсир вдохновения (2)",
        "Дневник странствий",
      ],
      wallet: { gold: 28, silver: 50, copper: 60, sp: 0 },
      backstory:
        "Странствующий бард и знаток древних баллад. Воодушевляет отряд в самые тяжелые моменты и умело фехтует рапирой.",
      notes: "Знает песнь, открывающую тайные двери в катакомбах.",
      baseColor: "#d4a75b",
      x: 256,
      y: 320,
      skills: [
        {
          key: "rapier-thrust",
          name: "Укол рапирой",
          rank: 2,
          formula: "1d20 + melee",
        },
        {
          key: "bard-song",
          name: "Песнь воодушевления",
          rank: 2,
          formula: "1d20 + charisma",
        },
      ],
      assignedAbilities: ["Вдохновение барда"],
    },
  };

  for (const player of betaPlayers) {
    let [member] = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.campaignId, campaign.id),
          eq(memberships.displayName, player.name),
        ),
      )
      .limit(1);

    if (!member) {
      const membershipId = randomUUID();
      [member] = await db
        .insert(memberships)
        .values({
          id: membershipId,
          campaignId: campaign.id,
          role: "PLAYER",
          displayName: player.name,
          defaultThemeId: defaultThemeForMembership(membershipId),
        })
        .returning();
    }

    if (member) {
      const [existingGrant] = await db
        .select()
        .from(playerAccessGrants)
        .where(
          and(
            eq(playerAccessGrants.campaignId, campaign.id),
            eq(playerAccessGrants.membershipId, member.id),
            sql`${playerAccessGrants.revokedAt} is null`,
          ),
        )
        .limit(1);

      if (!existingGrant) {
        await db
          .insert(playerAccessGrants)
          .values({
            campaignId: campaign.id,
            membershipId: member.id,
            label: `@${player.handle}`,
            tokenHash: hashToken(`beta-token-${player.handle}-${randomUUID()}`),
          })
          .onConflictDoNothing();
      }

      // Наполнение персонажа игрока
      const profile = betaHeroProfiles[player.handle];
      if (profile) {
        let [heroChar] = await db
          .select()
          .from(characters)
          .where(
            and(
              eq(characters.campaignId, campaign.id),
              eq(characters.ownerMembershipId, member.id),
            ),
          )
          .limit(1);

        if (!heroChar) {
          [heroChar] = await db
            .insert(characters)
            .values({
              campaignId: campaign.id,
              ownerMembershipId: member.id,
              name: profile.name,
              stats: profile.stats,
              skills: profile.skills,
              spells: [],
              inventory: profile.inventory,
              wallet: profile.wallet,
              resources: profile.resources,
              backstory: profile.backstory,
              notes: profile.notes,
            })
            .returning();
        }

        if (heroChar) {
          // Назначение способностей каталога
          for (const abilityName of profile.assignedAbilities) {
            const catEntry = seededCatalog.get(abilityName);
            if (catEntry) {
              const [existingAssigned] = await db
                .select()
                .from(characterCatalogEntries)
                .where(
                  and(
                    eq(characterCatalogEntries.characterId, heroChar.id),
                    eq(
                      characterCatalogEntries.sourceCatalogEntryId,
                      catEntry.id,
                    ),
                  ),
                )
                .limit(1);
              if (!existingAssigned) {
                await db
                  .insert(characterCatalogEntries)
                  .values({
                    characterId: heroChar.id,
                    sourceCatalogEntryId: catEntry.id,
                    kind: catEntry.kind,
                    name: catEntry.name,
                    description: catEntry.description,
                    data: catEntry.data,
                  })
                  .onConflictDoNothing();
              }
            }
          }

          // Токен персонажа на сцене
          if (scene) {
            let [tokenDef] = await db
              .select()
              .from(tokenDefinitions)
              .where(
                and(
                  eq(tokenDefinitions.campaignId, campaign.id),
                  eq(tokenDefinitions.characterId, heroChar.id),
                ),
              )
              .limit(1);
            if (!tokenDef) {
              [tokenDef] = await db
                .insert(tokenDefinitions)
                .values({
                  campaignId: campaign.id,
                  characterId: heroChar.id,
                  name: profile.name,
                  defaultWidth: 64,
                  defaultHeight: 64,
                })
                .returning();
            }

            if (tokenDef) {
              await db
                .insert(tokenControllers)
                .values({
                  tokenDefinitionId: tokenDef.id,
                  membershipId: member.id,
                })
                .onConflictDoNothing();

              const [placedToken] = await db
                .select()
                .from(tokens)
                .where(
                  and(
                    eq(tokens.sceneId, scene.id),
                    eq(tokens.characterId, heroChar.id),
                  ),
                )
                .limit(1);
              if (!placedToken) {
                await db.insert(tokens).values({
                  definitionId: tokenDef.id,
                  sceneId: scene.id,
                  characterId: heroChar.id,
                  ownerMembershipId: member.id,
                  name: profile.name,
                  x: profile.x,
                  y: profile.y,
                  width: 64,
                  height: 64,
                  baseColor: profile.baseColor,
                  layer: "PLAYER",
                  visible: true,
                });
              }
            }
          }
        }
      }
    }
  }

  // Демонстрационные враги на сцене
  if (scene) {
    const demoEnemies = [
      {
        name: "Гоблин-лазутчик 1",
        baseColor: "#4e7a3b",
        x: 832,
        y: 320,
        width: 64,
        height: 64,
      },
      {
        name: "Гоблин-лазутчик 2",
        baseColor: "#4e7a3b",
        x: 832,
        y: 448,
        width: 64,
        height: 64,
      },
      {
        name: "Вожак разбойников",
        baseColor: "#9c2a2a",
        x: 960,
        y: 384,
        width: 80,
        height: 80,
      },
    ];

    for (const enemy of demoEnemies) {
      let [enemyDef] = await db
        .select()
        .from(tokenDefinitions)
        .where(
          and(
            eq(tokenDefinitions.campaignId, campaign.id),
            eq(tokenDefinitions.name, enemy.name),
          ),
        )
        .limit(1);
      if (!enemyDef) {
        [enemyDef] = await db
          .insert(tokenDefinitions)
          .values({
            campaignId: campaign.id,
            characterId: null,
            name: enemy.name,
            defaultWidth: enemy.width,
            defaultHeight: enemy.height,
          })
          .returning();
      }

      if (enemyDef) {
        const [placedEnemy] = await db
          .select()
          .from(tokens)
          .where(and(eq(tokens.sceneId, scene.id), eq(tokens.name, enemy.name)))
          .limit(1);
        if (!placedEnemy) {
          await db.insert(tokens).values({
            definitionId: enemyDef.id,
            sceneId: scene.id,
            characterId: null,
            ownerMembershipId: null,
            name: enemy.name,
            x: enemy.x,
            y: enemy.y,
            width: enemy.width,
            height: enemy.height,
            baseColor: enemy.baseColor,
            layer: "PLAYER",
            visible: true,
          });
        }
      }
    }
  }
}

/**
 * Отдельная кампания со своим GM-токеном и той же стартовой обстановкой.
 *
 * Нужна e2e (UIX-518): все браузерные тесты работали с одной кампанией, и те
 * из них, что меняют состояние, роняли соседей через прогон. Ни один route
 * этого наружу не выставляет — кампания создаётся только процессом, у которого
 * уже есть доступ к базе.
 */
export async function createCampaignWithGmAccess(
  db: Database,
  name: string,
  gmAccessToken: string,
) {
  const [campaign] = await db.insert(campaigns).values({ name }).returning();
  if (!campaign) throw new Error("Could not create campaign");
  return seedCampaignContent(db, campaign, gmAccessToken);
}

export async function ensureSeed(db: Database) {
  /* `limit(1)` без сортировки возвращал произвольную строку. Пока кампания
     была одна, это не было видно; e2e создают свои, и «первая» стала зависеть
     от плана запроса. Порядок задан явно. */
  let [campaign] = await db
    .select()
    .from(campaigns)
    .orderBy(campaigns.createdAt)
    .limit(1);
  if (!campaign) {
    [campaign] = await db
      .insert(campaigns)
      .values({ name: "Arken — первая кампания" })
      .returning();
  }
  if (!campaign) throw new Error("Could not create campaign");

  const seeded = await seedCampaignContent(db, campaign, env.GM_ACCESS_TOKEN);
  await reconcileTokenOwnership(db);
  return seeded;
}
