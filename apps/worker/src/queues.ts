export const DEAD_LETTER_QUEUE = "dead-letter";

export const QUEUES = [
  { name: "discovery-high", concurrency: 3 },
  { name: "discovery-standard", concurrency: 2 },
  { name: "rescore-low", concurrency: 5 },
  { name: "billing", concurrency: 1 },
  { name: "outreach", concurrency: 2 },
  { name: "erasure", concurrency: 1 },
  { name: "notify", concurrency: 5 },
  { name: "system", concurrency: 2 },
] as const;

export type QueueName = (typeof QUEUES)[number]["name"];

export const QUEUE_OPTIONS = {
  retryLimit: 5,
  retryDelay: 5,
  retryBackoff: true,
  retryDelayMax: 600,
  deadLetter: DEAD_LETTER_QUEUE,
} as const;

const ROUTES: ReadonlyArray<readonly [string, QueueName]> = [
  ["discovery.", "discovery-high"],
  ["refresh.", "discovery-standard"],
  ["creator.", "rescore-low"],
  ["billing.", "billing"],
  ["outreach.", "outreach"],
  ["erasure.", "erasure"],
  ["notify.", "notify"],
  ["system.", "system"],
];

export function queueFor(eventType: string): QueueName {
  const hit = ROUTES.find(([prefix]) => eventType.startsWith(prefix));
  if (!hit) throw new Error(`No queue route for event type "${eventType}"`);
  return hit[1];
}
