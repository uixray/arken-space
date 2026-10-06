import React, { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "./Badge";
import { Button } from "./Button";
import {
  Clapperboard,
  Map,
  Layers,
  Palette,
  Cpu,
  Smartphone,
  Shield,
  Heart,
  Dice5,
  Coins,
  Sparkles,
  CheckCircle2,
  XCircle,
} from "lucide-react";

const meta: Meta = {
  title: "Design System/Philosophy & Manifest",
  parameters: {
    layout: "padded",
  },
};

export default meta;
type Story = StoryObj;

const THEMES = [
  { id: "dark", label: "Каноническая (Dark)", color: "#c46f49" },
  { id: "forest", label: "Лес (Forest)", color: "#48bb78" },
  { id: "dragons", label: "Драконы (Dragons)", color: "#a855f7" },
  { id: "ice", label: "Лёд (Ice)", color: "#38bdf8" },
  { id: "fire", label: "Огонь (Fire)", color: "#f97316" },
  { id: "gold", label: "Золото (Gold)", color: "#eab308" },
  { id: "silver", label: "Серебро (Silver)", color: "#94a3b8" },
  { id: "light", label: "Светлая (Light)", color: "#b45309" },
];

export const PhilosophyShowcase: Story = {
  render: () => {
    const [selectedTheme, setSelectedTheme] = useState("dark");
    const [density, setDensity] = useState<"compact" | "spacious">("spacious");
    const [compareMode, setCompareMode] = useState<"modern" | "old">("modern");

    return (
      <div
        data-player-theme={selectedTheme === "dark" ? undefined : selectedTheme}
        data-density={density}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 32,
          maxWidth: 1040,
          margin: "0 auto",
          color: "var(--color-text, #e8e4da)",
          fontFamily: "var(--font-family-base, sans-serif)",
        }}
      >
        {/* Header Block */}
        <div
          style={{
            padding: "24px 28px",
            background: "var(--surface-panel-floating, rgba(32, 32, 29, 0.85))",
            backdropFilter: "blur(14px)",
            borderRadius: "var(--radius-lg, 8px)",
            border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))",
            boxShadow:
              "var(--shadow-elevation-card, 0 8px 24px rgba(0,0,0,0.4))",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 8,
            }}
          >
            <Badge theme="info">Манифест v1.0</Badge>
            <span
              style={{
                fontSize: 12,
                color: "var(--color-text-muted, #aaa598)",
              }}
            >
              Октябрь 2026
            </span>
          </div>
          <h1 style={{ margin: "0 0 10px 0", fontSize: 26, fontWeight: 700 }}>
            «Живой цифровой театр и тактильная летопись»
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: 14,
              lineHeight: 1.6,
              color: "var(--color-text-muted, #aaa598)",
            }}
          >
            Философия Arken Space исходит из главного:{" "}
            <strong>
              создавать у игроков глубокое кинематографичное погружение, не
              мешая мастеру вести игру.
            </strong>{" "}
            Мы ушли от сухих бухгалтерских таблиц и отрицания нейродизайна к
            аутентичному, тактильному и адаптивному виртуальному столу.
          </p>

          {/* Interactive Controls Bar */}
          <div
            style={{
              marginTop: 20,
              paddingTop: 16,
              borderTop:
                "1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))",
              display: "flex",
              flexWrap: "wrap",
              gap: 16,
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--color-text-muted, #aaa598)",
                  marginBottom: 6,
                }}
              >
                ИНДИВИДУАЛЬНАЯ ПАЛИТРА ИГРОКА:
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedTheme(t.id)}
                    style={{
                      background:
                        selectedTheme === t.id
                          ? t.color
                          : "rgba(255, 255, 255, 0.05)",
                      color:
                        selectedTheme === t.id
                          ? "#fff"
                          : "var(--color-text, #e8e4da)",
                      border:
                        "1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))",
                      borderRadius: 4,
                      padding: "4px 10px",
                      fontSize: 12,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: t.color,
                        display: "inline-block",
                      }}
                    />
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: 12 }}>
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "var(--color-text-muted, #aaa598)",
                    marginBottom: 6,
                  }}
                >
                  ПЛОТНОСТЬ ИНТЕРФЕЙСА:
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <Button
                    size="xs"
                    view={density === "compact" ? "action" : "outlined"}
                    onClick={() => setDensity("compact")}
                  >
                    Компактная (Мастер)
                  </Button>
                  <Button
                    size="xs"
                    view={density === "spacious" ? "action" : "outlined"}
                    onClick={() => setDensity("spacious")}
                  >
                    Просторная (Игрок)
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* The 6 Pillars */}
        <div>
          <h2 style={{ fontSize: 18, marginBottom: 16 }}>
            Шесть столпов визуального языка Arken
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
              gap: 16,
            }}
          >
            {[
              {
                icon: (
                  <Clapperboard
                    size={20}
                    color="var(--color-accent, #c46f49)"
                  />
                ),
                title: "1. Кинематографичный театр",
                desc: "Виртуальный стол как живая сцена (Alchemy RPG). Интерфейс — незаметный режиссерский пульт с откликом 60 FPS, не закрывающий драму приключения.",
              },
              {
                icon: <Map size={20} color="var(--color-accent, #c46f49)" />,
                title: "2. Примат тактической карты",
                desc: "Карта и токены — главное на экране. Меню, чат и трекеры плавают поверх с мягким стеклянным блюром (14px), сохраняя контакт с миром игры.",
              },
              {
                icon: <Layers size={20} color="var(--color-accent, #c46f49)" />,
                title: "3. Избавление от «сотен обводок»",
                desc: "Отказ от сеток из тяжелых рамок. Разделение за счет глубины слоев, световых фасок и полупрозрачных тонких граней без визуального шума.",
              },
              {
                icon: (
                  <Palette size={20} color="var(--color-accent, #c46f49)" />
                ),
                title: "4. Персональные темы игроков",
                desc: "7 уникальных цветовых миров. Каждый игрок сам настраивает свои способности, навыки и инвентарь без ожидания мастера.",
              },
              {
                icon: <Cpu size={20} color="var(--color-accent, #c46f49)" />,
                title: "5. Постепенная автоматизация",
                desc: "Автоматический учет ресурсов, кошелька, спасбросков и модификаторов снимает рутинную головную боль с мастера и ускоряет партию.",
              },
              {
                icon: (
                  <Smartphone size={20} color="var(--color-accent, #c46f49)" />
                ),
                title: "6. Адаптивность и Split-Screen",
                desc: "Полная поддержка планшетов, смартфонов и режима пол-экрана рядом с Discord или заметками. Гибкая плотность под задачи.",
              },
            ].map((p, i) => (
              <div
                key={i}
                style={{
                  padding: density === "compact" ? "14px 16px" : "20px 22px",
                  background:
                    "var(--surface-panel-floating, rgba(32, 32, 29, 0.7))",
                  backdropFilter: "blur(12px)",
                  borderRadius: "var(--radius-lg, 8px)",
                  border:
                    "1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))",
                  boxShadow:
                    "var(--shadow-elevation-card, 0 4px 16px rgba(0,0,0,0.3))",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {p.icon}
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{p.title}</div>
                </div>
                <div
                  style={{
                    fontSize: 13,
                    lineHeight: 1.5,
                    color: "var(--color-text-muted, #aaa598)",
                  }}
                >
                  {p.desc}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* De-Bordering Interactive Comparison */}
        <div
          style={{
            padding: 24,
            background: "var(--surface-panel-floating, rgba(32, 32, 29, 0.6))",
            borderRadius: 8,
            border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 16,
            }}
          >
            <div>
              <h3 style={{ margin: "0 0 4px 0", fontSize: 16 }}>
                Принцип De-Bordering: Сравнение подходов к верстке
              </h3>
              <div
                style={{
                  fontSize: 13,
                  color: "var(--color-text-muted, #aaa598)",
                }}
              >
                Сравните традиционный утилитарный интерфейс с «сотнями рамок» и
                глубину Arken.
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <Button
                size="xs"
                view={compareMode === "old" ? "danger" : "outlined"}
                onClick={() => setCompareMode("old")}
              >
                <XCircle size={14} style={{ marginRight: 4 }} />
                Сотни рамок (Old)
              </Button>
              <Button
                size="xs"
                view={compareMode === "modern" ? "action" : "outlined"}
                onClick={() => setCompareMode("modern")}
              >
                <CheckCircle2 size={14} style={{ marginRight: 4 }} />
                Arken De-Bordering (New)
              </Button>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 20,
            }}
          >
            {/* Card Example: Old Utilitarian Borders */}
            <div
              style={{
                padding: 16,
                background: compareMode === "old" ? "#1e1e1e" : "#1e1e1e44",
                border: "2px solid #555555",
                borderRadius: 4,
                opacity: compareMode === "old" ? 1 : 0.6,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#f87171",
                  marginBottom: 12,
                }}
              >
                ❌ Утилитарная сетка (Тяжелые рамки, шум)
              </div>
              <div
                style={{
                  border: "1px solid #444",
                  padding: 12,
                  marginBottom: 8,
                  background: "#111",
                }}
              >
                <div
                  style={{
                    borderBottom: "1px solid #444",
                    paddingBottom: 6,
                    marginBottom: 6,
                    fontWeight: 600,
                  }}
                >
                  Воин Торин
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <div
                    style={{
                      border: "1px solid #444",
                      padding: 6,
                      flex: 1,
                      textAlign: "center",
                    }}
                  >
                    HP: 24/24
                  </div>
                  <div
                    style={{
                      border: "1px solid #444",
                      padding: 6,
                      flex: 1,
                      textAlign: "center",
                    }}
                  >
                    AC: 16
                  </div>
                  <div
                    style={{
                      border: "1px solid #444",
                      padding: 6,
                      flex: 1,
                      textAlign: "center",
                    }}
                  >
                    Init: +2
                  </div>
                </div>
                <div
                  style={{
                    border: "1px solid #444",
                    marginTop: 8,
                    padding: 6,
                    textAlign: "center",
                  }}
                >
                  <button
                    style={{
                      border: "1px solid #666",
                      background: "#333",
                      color: "#eee",
                      width: "100%",
                      padding: 6,
                    }}
                  >
                    Бросок атаки
                  </button>
                </div>
              </div>
            </div>

            {/* Card Example: Arken Modern Depth */}
            <div
              style={{
                padding: 18,
                background:
                  "var(--surface-panel-floating, rgba(32, 32, 29, 0.9))",
                backdropFilter: "blur(14px)",
                border:
                  "1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))",
                boxShadow:
                  "var(--shadow-elevation-card, 0 8px 24px rgba(0, 0, 0, 0.45)), inset 0 1px 0 rgba(255, 255, 255, 0.06)",
                borderRadius: 8,
                opacity: compareMode === "modern" ? 1 : 0.6,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "var(--color-accent, #48bb78)",
                  marginBottom: 12,
                }}
              >
                ✨ Arken Visual Depth (Слои, свет, микро-фаски)
              </div>
              <div
                style={{
                  background: "var(--surface-raised, rgba(41, 40, 36, 0.75))",
                  padding: 14,
                  borderRadius: 6,
                  border:
                    "1px solid var(--border-delicate, rgba(255, 255, 255, 0.04))",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 12,
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: "50%",
                        background: "var(--color-accent, #c46f49)",
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 700,
                        fontSize: 16,
                        boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
                      }}
                    >
                      Т
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>
                        Торин Камнелом
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--color-text-muted, #aaa598)",
                        }}
                      >
                        Дворф • Воин 3 ур.
                      </div>
                    </div>
                  </div>
                  <Badge theme="info">Ваш герой</Badge>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, 1fr)",
                    gap: 8,
                    marginBottom: 12,
                  }}
                >
                  <div
                    style={{
                      background: "rgba(0,0,0,0.25)",
                      padding: "8px 10px",
                      borderRadius: 4,
                      textAlign: "center",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 10,
                        color: "var(--color-text-muted, #aaa598)",
                        textTransform: "uppercase",
                      }}
                    >
                      Здоровье
                    </div>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 14,
                        color: "#4ade80",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 4,
                      }}
                    >
                      <Heart size={12} /> 24 / 24
                    </div>
                  </div>
                  <div
                    style={{
                      background: "rgba(0,0,0,0.25)",
                      padding: "8px 10px",
                      borderRadius: 4,
                      textAlign: "center",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 10,
                        color: "var(--color-text-muted, #aaa598)",
                        textTransform: "uppercase",
                      }}
                    >
                      Броня (КД)
                    </div>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 14,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 4,
                      }}
                    >
                      <Shield size={12} /> 16
                    </div>
                  </div>
                  <div
                    style={{
                      background: "rgba(0,0,0,0.25)",
                      padding: "8px 10px",
                      borderRadius: 4,
                      textAlign: "center",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 10,
                        color: "var(--color-text-muted, #aaa598)",
                        textTransform: "uppercase",
                      }}
                    >
                      Казна
                    </div>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 14,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 4,
                        color: "#facc15",
                      }}
                    >
                      <Coins size={12} /> 45 зм
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <Button size="s" view="action" width="max">
                      <Dice5 size={14} style={{ marginRight: 6 }} />
                      Бросок атаки (d20+5)
                    </Button>
                  </div>
                  <Button size="s" view="flat">
                    <Sparkles size={14} />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Self-Management Callout */}
        <div
          style={{
            padding: 20,
            background: "var(--surface-raised, rgba(41, 40, 36, 0.7))",
            borderRadius: 8,
            border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 16,
          }}
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>
              Автономия игроков за столом
            </div>
            <div
              style={{
                fontSize: 13,
                color: "var(--color-text-muted, #aaa598)",
                maxWidth: 640,
              }}
            >
              Игроки больше не скованы ожиданием мастера: каждый участник партии
              имеет полный доступ к созданию и настройке собственного листа
              героя, выбору навыков, управлению ячейками способностей и казне.
            </div>
          </div>
          <Badge theme="success">ACL Self-Management Enabled</Badge>
        </div>
      </div>
    );
  },
};
