import type { Card, CardAction } from "./types";

const RESERVED_SYNTHETIC_CARD_ACTION_IDS = new Set(["dismiss-card", "default-cleanup", "proposed-action"]);

export function isReservedCardActionId(id: string): boolean {
  return RESERVED_SYNTHETIC_CARD_ACTION_IDS.has(id);
}

export function safeConfiguredCardActions(actions: CardAction[] | undefined): CardAction[] {
  return (actions ?? []).filter((action) => !isReservedCardActionId(action.id));
}

export function visibleCardActions(card: Card): CardAction[] {
  const dismiss: CardAction = {
    id: "dismiss-card",
    label: "Dismiss card",
    behavior: "dismiss_card",
    variant: "secondary",
    shortcut: "d",
  };
  if (card.attentionState) return [dismiss];
  const configuredActions = safeConfiguredCardActions(card.actions);
  if (configuredActions.length) {
    return configuredActions.some((action) => action.behavior === "dismiss_card")
      ? configuredActions
      : [dismiss, ...configuredActions];
  }
  if (!card.proposedAction || card.proposedAction.label === "Decide disposition") return [dismiss];
  if (card.proposedAction.label === "Archive" || card.proposedAction.label === "Archive this thread") {
    return [dismiss, {
      id: "default-cleanup",
      label: "Archive",
      behavior: "default_cleanup",
      variant: "primary",
      shortcut: "x",
    }];
  }
  return [
    dismiss,
    {
      id: "proposed-action",
      label: card.proposedAction.label,
      behavior: "approve_action",
      instruction: card.proposedAction.instruction,
      artifactBlockId: card.proposedAction.artifactBlockId,
      externalMutation: card.proposedAction.externalMutation,
      mailboxPolicy: card.proposedAction.mailboxPolicy,
      variant: "primary",
      shortcut: "a",
    },
  ];
}
