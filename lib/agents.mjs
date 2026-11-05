import { httpError } from "./auth.mjs";
import { readHistory } from "./history.mjs";

const sourceKinds = ["subAgent", "subAgentReview", "subAgentCompact", "subAgentThreadSpawn", "subAgentOther"];
const PAGE_SIZE = 50;
export const isAgentThread = (thread) => Boolean(
  thread.parentThreadId || thread.source?.subAgent ||
  (typeof thread.source === "string" && thread.source.startsWith("subAgent")),
);
function summary(thread, archived = false) {
  const spawn = thread.source?.subAgent?.thread_spawn;
  return {
    id: thread.id,
    name: thread.name || thread.agentNickname || spawn?.agent_nickname || "",
    role: thread.agentRole || spawn?.agent_role || "",
    preview: thread.preview || "",
    parentThreadId: thread.parentThreadId || spawn?.parent_thread_id || null,
    status: thread.status || { type: "notLoaded" },
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    archived,
  };
}
function decodeCursor(cursor, project) {
  if (!cursor) return { archived: false, cursor: null };
  try {
    if (typeof cursor !== "string" || cursor.length > 8192) throw new Error();
    const value = JSON.parse(Buffer.from(cursor, "base64url"));
    if (value.project !== project.id || typeof value.archived !== "boolean" ||
      (value.cursor !== null && typeof value.cursor !== "string")) throw new Error();
    return value;
  } catch {
    throw httpError(400, "Ungültige Position in der Agent-Liste.");
  }
}
const encodeCursor = (project, archived, cursor) => Buffer.from(JSON.stringify({ project: project.id, archived, cursor })).toString("base64url");

export async function listProjectAgents(bridge, project, cursor) {
  const position = decodeCursor(cursor, project);
  const data = [];
  for (const archived of position.archived ? [true] : [false, true]) {
    const page = await bridge.call("thread/list", {
      cwd: project.path,
      sourceKinds,
      modelProviders: [],
      sortKey: "updated_at",
      sortDirection: "desc",
      archived,
      limit: PAGE_SIZE - data.length,
      ...(archived === position.archived && position.cursor ? { cursor: position.cursor } : {}),
    });
    data.push(...page.data.filter((thread) => thread.cwd === project.path && isAgentThread(thread)).map((thread) => summary(thread, archived)));
    if (page.nextCursor) return { data, nextCursor: encodeCursor(project, archived, page.nextCursor) };
    if (!archived && data.length >= PAGE_SIZE) return { data, nextCursor: encodeCursor(project, true, null) };
  }
  return { data, nextCursor: null };
}

export async function readProjectAgent(bridge, project, id, cursor) {
  const { thread } = await bridge.call("thread/read", { threadId: id, includeTurns: false });
  if (thread.cwd !== project.path || !isAgentThread(thread))
    throw httpError(404, "Dieser Agent gehört nicht zu diesem Projekt.");
  const agent = summary(thread);
  const parent = async () => {
    if (!agent.parentThreadId) return null;
    try {
      const result = await bridge.call("thread/read", { threadId: agent.parentThreadId, includeTurns: false });
      if (result.thread.cwd !== project.path) return null;
      return { id: result.thread.id, name: result.thread.name || result.thread.preview?.slice(0, 100) || "", isAgent: isAgentThread(result.thread) };
    } catch { return null; }
  };
  const [history, parentThread] = await Promise.all([readHistory(bridge, id, cursor), parent()]);
  return { agent, parent: parentThread, ...history };
}
