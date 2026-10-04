/** Bot domain values normalized from the supported OpenCode server API. */
import type {
  AgentInfo,
  FileDiffInfo,
  SessionInfo,
  SessionMessageAssistant,
} from "@opencode/client";

export interface Session {
  id: string;
  slug: string;
  projectID: string;
  directory: string;
  title: string;
  version: string;
  parentID?: string;
  agent?: string;
  model?: SessionInfo["model"];
  cost?: number;
  tokens?: SessionInfo["tokens"];
  time: { created: number; updated: number; archived?: number; compacting?: number };
  revert?: { messageID: string };
}
export type GlobalSession = Session & {
  project: { id: string; worktree: string; name?: string } | null;
};
export interface Project {
  id: string;
  worktree: string;
  name?: string;
  time: { created: number; updated: number; initialized?: number };
  sandboxes: string[];
}
export type Tokens = NonNullable<SessionMessageAssistant["tokens"]>;
export interface MessageError {
  name: string;
  data: { message: string };
}
interface MessageBase {
  id: string;
  sessionID: string;
  agent: string;
}
export interface UserMessage extends MessageBase {
  role: "user";
  time: { created: number };
  model: { providerID: string; modelID: string };
  summary?: { title?: string; body?: string; diffs: FileDiff[] };
}
export interface AssistantMessage extends MessageBase {
  role: "assistant";
  time: { created: number; completed?: number };
  error?: MessageError;
  parentID: string;
  modelID: string;
  providerID: string;
  mode: string;
  path: { cwd: string; root: string };
  cost: number;
  tokens: Tokens;
  variant?: string;
  finish?: string;
  summary?: boolean;
}
export type Message = UserMessage | AssistantMessage;
export interface TextPartInput {
  type: "text";
  text: string;
}
export interface FilePartInput {
  type: "file";
  mime: string;
  filename?: string;
  url: string;
}
interface PartBase {
  id: string;
  sessionID: string;
  messageID: string;
}
export type ToolState =
  | { status: "pending"; input: Record<string, unknown>; raw: string }
  | {
      status: "running";
      input: Record<string, unknown>;
      title?: string;
      metadata?: Record<string, unknown>;
      time: { start: number };
    }
  | {
      status: "completed";
      input: Record<string, unknown>;
      output: string;
      title: string;
      metadata: Record<string, unknown>;
      time: { start: number; end: number };
    }
  | {
      status: "error";
      input: Record<string, unknown>;
      error: string;
      metadata?: Record<string, unknown>;
      time: { start: number; end: number };
    };
export type Part = PartBase &
  (
    | {
        type: "text";
        text: string;
        ignored?: boolean;
        synthetic?: boolean;
        time?: { start: number; end?: number };
      }
    | { type: "reasoning"; text: string; time: { start: number; end?: number } }
    | FilePartInput
    | { type: "tool"; callID: string; tool: string; state: ToolState }
    | { type: "step-start"; snapshot?: string }
    | { type: "step-finish"; reason: string; snapshot?: string; cost: number; tokens: Tokens }
  );
export interface FileDiff {
  path: string;
  status: FileDiffInfo["status"];
  additions: number;
  deletions: number;
  patch: string;
}
export type Model = ReturnType<typeof import("./v2/mappers.js").toModel>;
export interface Provider {
  id: string;
  name: string;
  source: string;
  env: string[];
  options: Record<string, unknown>;
  models: Record<string, Model>;
}
export interface Agent {
  name: string;
  description?: string;
  mode: AgentInfo["mode"];
  hidden?: boolean;
  color?: string;
  permission: unknown[];
  model?: { modelID: string; providerID: string };
  options: Record<string, unknown>;
  steps?: number;
}
export interface Command {
  name: string;
  description?: string;
  source: "command" | "skill";
  template: string;
  hints: string[];
}
export type McpStatus =
  | { status: "connected" | "disabled" | "needs_auth" }
  | { status: "failed" | "needs_client_registration"; error: string };
export interface PermissionRequest {
  id: string;
  sessionID: string;
  permission: string;
  patterns: string[];
  metadata: Record<string, unknown>;
  always: string[];
}
export interface QuestionInfo {
  question: string;
  header: string;
  options: { label: string; description: string; value?: string }[];
  multiple?: boolean;
  custom?: boolean;
}
export interface QuestionRequest {
  id: string;
  sessionID: string;
  questions: QuestionInfo[];
}
export type SessionStatus =
  | { type: "idle" }
  | { type: "busy" }
  | { type: "retry"; attempt: number; message: string; next: number };
interface EventProperties {
  "server.connected": { restarted?: boolean };
  "server.heartbeat": Record<string, never>;
  "session.created": { info: Session; sessionID?: string };
  "session.updated": { info: Session; sessionID?: string };
  "session.deleted": { info: Session; sessionID?: string };
  "session.status": { sessionID: string; status: SessionStatus };
  "session.idle": { sessionID: string; interrupted?: true };
  "session.error": { sessionID?: string; error: MessageError };
  "session.compacted": { sessionID: string };
  "message.updated": { info: Message; sessionID?: string };
  "message.part.updated": { part: Part; delta?: string; sessionID?: string; time?: number };
  "message.part.delta": {
    sessionID: string;
    messageID: string;
    partID: string;
    field: string;
    delta: string;
  };
  "permission.asked": PermissionRequest;
  "permission.replied": { sessionID: string; requestID: string; reply: string };
  "question.asked": QuestionRequest;
  "question.replied": { sessionID: string; requestID: string; answers: string[][] };
  "question.rejected": { sessionID: string; requestID: string };
}
export type Event = {
  [K in keyof EventProperties]: { id?: string; type: K; properties: EventProperties[K] };
}[keyof EventProperties];
