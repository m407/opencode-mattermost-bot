import { t } from "../i18n/index.js";
import { opencodeClient } from "../opencode/client.js";
import { MattermostMessages, type ReplyTarget } from "./messages.js";

export interface PendingPermission {
  id: string;
  sessionID: string;
  permission: string;
  patterns: string[];
}
export interface PendingQuestion {
  id: string;
  sessionID: string;
  questions: {
    question: string;
    header: string;
    options: { label: string; description: string; value?: string }[];
    multiple?: boolean;
    custom?: boolean;
  }[];
}
type Interaction =
  | { kind: "permission"; request: PendingPermission }
  | { kind: "question"; request: PendingQuestion };
type Visible = Interaction & {
  postId: string;
  text: string;
  directory: string;
  target: ReplyTarget;
};

export class MattermostInteractions {
  private generation = 0;
  private readonly pending = new Map<string, Visible>();
  constructor(private readonly messages: MattermostMessages) {}

  async show(interaction: Interaction, directory: string, target: ReplyTarget): Promise<void> {
    const generation = this.generation;
    const { request } = interaction;
    if (this.pending.has(request.id)) return;
    const text =
      interaction.kind === "permission"
        ? t("mattermost.interactions.permission_permission_once_always_reject", {
            value1: interaction.request.permission,
            value2: interaction.request.patterns.join("\n"),
            value3: request.id,
          })
        : t("mattermost.interactions.opencode_question_answer_every_question_in_order_answer", {
            value1: interaction.request.questions
              .map(
                (q, i) =>
                  `${i + 1}. ${q.question}\n${q.options.map((o) => `- ${o.label}: ${o.description}`).join("\n")}${q.multiple ? "\nChoose one or more." : ""}${q.custom === false ? "\nChoose from the listed answers." : ""}`,
              )
              .join("\n\n"),
            value2: request.id,
            value3: request.id,
          });
    const buttons =
      interaction.kind === "permission"
        ? ["once", "always", "reject"].map((decision) => ({
            name: decision,
            data: `permission ${request.id} ${decision}`,
          }))
        : interaction.request.questions.length === 1 && !interaction.request.questions[0]!.multiple
          ? interaction.request.questions[0]!.options.map((option) => ({
              name: option.label,
              data: `answer ${request.id} ${JSON.stringify([[option.label]])}`,
            }))
          : [];
    if (interaction.kind === "question")
      buttons.push({ name: t("mattermost.interactions.cancel"), data: `cancel ${request.id}` });
    const postId = await this.messages.card(target, text, buttons.slice(0, 20));
    if (generation !== this.generation) {
      await this.messages.closeCard(
        postId,
        t("mattermost.interactions.no_longer_followed", { value1: text }),
      );
      return;
    }
    this.pending.set(request.id, { ...interaction, postId, text, directory, target });
  }

  async answer(id: string, value: string, target: ReplyTarget, cancel = false): Promise<void> {
    const active = this.pending.get(id);
    if (
      !active ||
      target.channelId !== active.target.channelId ||
      (target.rootId && target.rootId !== active.target.rootId && target.rootId !== active.postId)
    ) {
      throw new Error(
        t("mattermost.interactions.this_request_is_no_longer_pending_in_this_thread"),
      );
    }
    // The bot serializes commands, so an in-flight response cannot be submitted twice.
    if (active.kind === "permission") {
      if (!["once", "always", "reject"].includes(value))
        throw new Error(t("mattermost.interactions.choose_once_always_or_reject"));
      const { error } = await opencodeClient.permission.reply({
        requestID: id,
        directory: active.directory,
        reply: value as "once" | "always" | "reject",
      });
      if (error) throw error;
    } else if (cancel) {
      const { error } = await opencodeClient.question.reject({
        requestID: id,
        directory: active.directory,
      });
      if (error) throw error;
    } else {
      const answers: unknown = JSON.parse(value);
      if (!Array.isArray(answers) || answers.length !== active.request.questions.length)
        throw new Error(t("mattermost.interactions.supply_one_answer_array_per_question"));
      const normalized: string[][] = [];
      for (let i = 0; i < answers.length; i++) {
        const answer: unknown = answers[i];
        const question = active.request.questions[i]!;
        if (
          !Array.isArray(answer) ||
          !answer.length ||
          answer.some((v) => typeof v !== "string") ||
          (!question.multiple && answer.length !== 1)
        )
          throw new Error(t("mattermost.interactions.invalid_question_answer"));
        const values = answer as string[];
        if (
          question.custom === false &&
          values.some((v) => !question.options.some((o) => o.label === v || o.value === v))
        ) {
          throw new Error(
            t("mattermost.interactions.custom_answers_are_not_allowed_for_this_question"),
          );
        }
        normalized.push(values.map((v) => question.options.find((o) => o.label === v)?.value ?? v));
      }
      const { error } = await opencodeClient.question.reply({
        requestID: id,
        directory: active.directory,
        answers: normalized,
      });
      if (error) throw error;
    }
    await this.settle(
      id,
      cancel ? t("mattermost.interactions.cancelled") : t("mattermost.interactions.answered"),
    );
  }

  async settle(id: string, outcome: string): Promise<void> {
    const active = this.pending.get(id);
    if (!active) return;
    this.pending.delete(id);
    await this.messages.closeCard(active.postId, `${active.text}\n\n**${outcome}**`);
  }

  async clear(outcome = "Not answered"): Promise<void> {
    this.generation++;
    for (const id of [...this.pending.keys()]) await this.settle(id, outcome);
  }

  async reconcile(
    directory: string,
    target: ReplyTarget,
    accepts: (id: string) => Promise<boolean>,
  ): Promise<void> {
    const [permissions, questions] = await Promise.all([
      opencodeClient.permission.list({ directory }),
      opencodeClient.question.list({ directory }),
    ]);
    if (permissions.error || questions.error) throw permissions.error || questions.error;
    const visible = new Set<string>();
    for (const request of permissions.data ?? [])
      if (await accepts(request.sessionID)) {
        visible.add(request.id);
        await this.show({ kind: "permission", request }, directory, target);
      }
    for (const request of questions.data ?? [])
      if (await accepts(request.sessionID)) {
        visible.add(request.id);
        await this.show({ kind: "question", request }, directory, target);
      }
    for (const [id, active] of this.pending)
      if (active.directory === directory && !visible.has(id)) {
        await this.settle(id, t("mattermost.activity.settled_in_opencode"));
      }
  }
}
