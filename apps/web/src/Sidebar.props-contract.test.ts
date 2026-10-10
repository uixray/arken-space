import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const expectedSidebarDataProps = [
  "snapshot",
  "requestedCharacterId",
  "socket",
  "presence",
  "storyPosts",
  "storyNextCursor",
  "viewedSceneId",
  "sceneDialogRequest",
  "requestedSceneEditId",
  "selectedTokenIds",
  "canRecruitFromBattleZone",
  "requestedChatMessageId",
  "collapsed",
  "compact",
  "chatVisible",
  "keepCharacterWorkspaceMounted",
  "workspaceSidebarWidth",
  "workspace",
  "operatorFeedbackAllowed",
];

function readSource(url: URL, fileName: string) {
  const text = readFileSync(url, "utf8");
  return ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

describe("Sidebar action-context boundary", () => {
  it("keeps only the explicit 18 data/state props in its public contract", () => {
    const syntax = readSource(
      new URL("./Sidebar.tsx", import.meta.url),
      "Sidebar.tsx",
    );
    let members: string[] = [];
    function visit(node: ts.Node) {
      if (
        ts.isTypeAliasDeclaration(node) &&
        node.name.text === "Props" &&
        ts.isTypeLiteralNode(node.type)
      ) {
        members = node.type.members
          .filter(ts.isPropertySignature)
          .map((member) => member.name?.getText(syntax) ?? "");
      }
      ts.forEachChild(node, visit);
    }
    visit(syntax);
    expect(members).toEqual(expectedSidebarDataProps);
    expect(members.some((name) => /^on[A-Z]/.test(name))).toBe(false);
  });

  it("keeps the App call site aligned with that same data-only manifest", () => {
    const syntax = readSource(new URL("./App.tsx", import.meta.url), "App.tsx");
    let attributes: string[] = [];
    function visit(node: ts.Node) {
      if (
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        node.tagName.getText(syntax) === "Sidebar"
      ) {
        attributes = node.attributes.properties
          .filter(ts.isJsxAttribute)
          .map((attribute) => attribute.name.getText(syntax))
          .filter((name) => name !== "key");
      }
      ts.forEachChild(node, visit);
    }
    visit(syntax);
    expect(attributes.sort()).toEqual([...expectedSidebarDataProps].sort());
  });
});
