import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { InitiativeParticipantDto } from "@arken/contracts";
import { InitiativePanel } from "../sidebar/InitiativePanel";

const initialParticipants: InitiativeParticipantDto[] = [
  {
    id: "p1",
    tokenId: "token-1",
    name: "Ллойд (Паладин)",
    ownName: null,
    initiative: 22,
    initiativeBonus: 2,
    canEdit: true,
    pinned: false,
  },
  {
    id: "p2",
    tokenId: "token-2",
    name: "Вожак стаи (Гоблин)",
    ownName: null,
    initiative: 18,
    initiativeBonus: 3,
    canEdit: false,
    pinned: false,
  },
  {
    id: "p3",
    tokenId: "token-3",
    name: "Тэйн (Следопыт)",
    ownName: null,
    initiative: 15,
    initiativeBonus: 4,
    canEdit: true,
    pinned: false,
  },
  {
    id: "p4",
    tokenId: "token-4",
    name: "Гоблин-лучник #1",
    ownName: null,
    initiative: 11,
    initiativeBonus: 2,
    canEdit: false,
    pinned: false,
  },
  {
    id: "p5",
    tokenId: null,
    name: "Призванный волк",
    ownName: "Призванный волк",
    initiative: 8,
    initiativeBonus: null,
    canEdit: true,
    pinned: true,
  },
];

const meta: Meta<typeof InitiativePanel> = {
  title: "Tabletop Mechanics/InitiativePanel",
  component: InitiativePanel,
  parameters: {
    layout: "padded",
  },
};

export default meta;
type Story = StoryObj<typeof InitiativePanel>;

function InteractiveDemo({ isGm }: { isGm: boolean }) {
  const [participants, setParticipants] = useState<InitiativeParticipantDto[]>(initialParticipants);
  const [selectedTokens, setSelectedTokens] = useState<string[]>(["token-new-1"]);

  return (
    <div style={{ maxWidth: 380, margin: "0 auto", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius-md)" }}>
      <InitiativePanel
        participants={participants}
        isGm={isGm}
        pending={false}
        selectedTokenIds={selectedTokens}
        onUpdate={setParticipants}
        onSetOwnInitiative={(id, value) => {
          setParticipants((prev) =>
            prev.map((p) => (p.id === id ? { ...p, initiative: value } : p)),
          );
        }}
        onRoll={(p) => {
          const roll = Math.floor(Math.random() * 20) + 1 + (p.initiativeBonus ?? 0);
          setParticipants((prev) =>
            prev.map((item) => (item.id === p.id ? { ...item, initiative: roll } : item)),
          );
        }}
        onRecruitFromZone={() => {
          setSelectedTokens([]);
        }}
      />
    </div>
  );
}

export const GameMasterView: Story = {
  name: "Режим мастера (GM View)",
  render: () => <InteractiveDemo isGm={true} />,
};

export const PlayerView: Story = {
  name: "Режим игрока (Player View)",
  render: () => <InteractiveDemo isGm={false} />,
};

export const EmptyState: Story = {
  name: "Пустая очередь (Empty)",
  render: () => (
    <div style={{ maxWidth: 380, margin: "0 auto", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--radius-md)" }}>
      <InitiativePanel
        participants={[]}
        isGm={true}
        pending={false}
        selectedTokenIds={[]}
        onUpdate={() => {}}
        onSetOwnInitiative={() => {}}
      />
    </div>
  ),
};
