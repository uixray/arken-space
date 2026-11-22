import { createInterface } from "node:readline";
import process from "node:process";
import { URL, URLSearchParams } from "node:url";

const base = new URL(
  process.env.ARKEN_EDITOR_URL ?? "https://arken-khar.space",
);
if (base.protocol !== "https:" && base.origin !== "http://127.0.0.1:3001") {
  throw new Error("ARKEN_EDITOR_URL must use HTTPS");
}
const token = process.env.ARKEN_EDITOR_TOKEN;
const kind = { type: "string", enum: ["character-stat", "skill", "material"] };
const id = { type: "string", format: "uuid" };
const target = { kind, id };
const instructions =
  "Понимай обычные фразы вроде «Подними Мире силу на 1». Сам найди запись, прочитай её ревизию и рассчитай новое значение. При неоднозначности задай короткий вопрос. После предпросмотра покажи только строки изменений и короткую ссылку «Подтвердить». Не показывай JSON, ID, ревизии и названия инструментов. Жди подтверждения в Arken Space.";
const fieldLabels = {
  strength: "Сила",
  name: "Название",
  description: "Описание",
  title: "Заголовок",
  body: "Текст",
  steps: "Шаги",
  expected: "Ожидалось",
  actual: "Произошло",
};
const string = { type: "string" };
const schema = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const tools = [
  {
    name: "preview_creation",
    description:
      "Подготовить создание записи. Для character-stat передай name, для skill — name и description, для material — title и body. Запись появится после подтверждения.",
    inputSchema: schema({
      kind,
      values: { type: "object", additionalProperties: string },
    }),
  },
  {
    name: "preview_bug_report",
    description:
      "Подготовить баг-репорт для входящих Arken Space. Уточни пропущенные факты, покажи ссылку на отправку.",
    inputSchema: schema({
      title: string,
      steps: string,
      expected: string,
      actual: string,
    }),
  },
  {
    name: "search_records",
    description: "Найти записи по названию в Бале Амбериона",
    inputSchema: schema({ kind, query: { type: "string" } }),
  },
  {
    name: "read_record",
    description: "Прочитать редактируемые поля и текущую ревизию",
    inputSchema: schema(target),
  },
  {
    name: "preview_change",
    description: "Подготовить черновик и ссылку для подтверждения человеком",
    inputSchema: schema({
      ...target,
      revision: { type: "integer", minimum: 0 },
      values: {
        type: "object",
        additionalProperties: { type: ["string", "number"] },
      },
    }),
  },
  {
    name: "read_history",
    description: "Показать подтверждённые правки по объекту",
    inputSchema: schema(target),
  },
  {
    name: "preview_restore",
    description: "Подготовить откат и ссылку для подтверждения человеком",
    inputSchema: schema({ changeId: id }),
  },
];

async function call({ name, arguments: args }) {
  if (!token) throw new Error("Настройте токен пилота.");
  if (!args || typeof args !== "object")
    throw new Error("Некорректные параметры.");
  const query = new URLSearchParams({ kind: args.kind, id: args.id });
  let path,
    body,
    method = "GET";
  switch (name) {
    case "preview_creation":
      if (!kind.enum.includes(args.kind))
        throw new Error("Неизвестный тип записи.");
      path = "/api/editor/creations";
      method = "POST";
      body = { kind: args.kind, values: args.values };
      break;
    case "preview_bug_report":
      path = "/api/editor/creations";
      method = "POST";
      body = { kind: "bug-report", values: args };
      break;
    case "search_records":
      path =
        "/api/editor/search?" +
        new URLSearchParams({ kind: args.kind, q: args.query });
      break;
    case "read_record":
      path = "/api/editor/target?" + query;
      break;
    case "read_history":
      path = "/api/editor/history?" + query;
      break;
    case "preview_change":
      path = "/api/editor/changes";
      method = "POST";
      body = {
        target: { kind: args.kind, id: args.id },
        revision: args.revision,
        values: args.values,
      };
      break;
    case "preview_restore":
      if (
        typeof args.changeId !== "string" ||
        !/^[\da-f-]{36}$/i.test(args.changeId)
      )
        throw new Error("Некорректный ID операции.");
      path = `/api/editor/changes/${args.changeId}/restore-preview`;
      method = "POST";
      break;
    default:
      throw new Error("Неизвестный инструмент.");
  }
  const response = await globalThis.fetch(new URL(path, base.origin), {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
    signal: globalThis.AbortSignal.timeout(15000),
    headers: {
      authorization: `Bearer ${token}`,
      ...(body && { "content-type": "application/json" }),
    },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
  if (result?.approvalUrl && result.after && result.before) {
    const lines = Object.entries(result.after).map(([key, value]) => {
      const label = result.fieldLabels?.[key] ?? fieldLabels[key] ?? key;
      const before = result.creates ? "" : `${result.before[key] ?? "—"} → `;
      return `${label} ${before}${value ?? "—"}`;
    });
    lines.push(`[Подтвердить](${result.approvalUrl})`);
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
}

function send(id, response) {
  process.stdout.write(
    JSON.stringify({ jsonrpc: "2.0", id, ...response }) + "\n",
  );
}

async function listTools() {
  // The installed launcher can be newer than the deployed campaign API.
  const existingTools = tools.filter(
    ({ name }) => name !== "preview_creation" && name !== "preview_bug_report",
  );
  if (!token) return existingTools;
  try {
    const response = await globalThis.fetch(
      new URL("/api/editor/capabilities", base),
      {
        redirect: "error",
        signal: globalThis.AbortSignal.timeout(5000),
        headers: { authorization: `Bearer ${token}` },
      },
    );
    if (response.ok && (await response.json()).creation === true) return tools;
  } catch {
    // Keep read and edit tools available during a deployment or connection loss.
  }
  return existingTools;
}

for await (const line of createInterface({ input: process.stdin })) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    continue;
  }
  if (!request || !Object.hasOwn(request, "id")) continue;
  const { id, method, params } = request;
  try {
    switch (method) {
      case "initialize":
        send(id, {
          result: {
            protocolVersion: [
              "2024-11-05",
              "2025-03-26",
              "2025-06-18",
              "2025-11-25",
            ].includes(params?.protocolVersion)
              ? params.protocolVersion
              : "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: "arken-space", version: "0.1.0" },
            instructions,
          },
        });
        break;
      case "ping":
        send(id, { result: {} });
        break;
      case "tools/list":
        send(id, { result: { tools: await listTools() } });
        break;
      case "tools/call":
        send(id, { result: await call(params ?? {}) });
        break;
      default:
        send(id, { error: { code: -32601, message: "Method not found" } });
    }
  } catch (error) {
    send(id, {
      result: {
        isError: true,
        content: [{ type: "text", text: error.message }],
      },
    });
  }
}
