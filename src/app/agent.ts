import { createAgent, registerTools } from "@ui-sdk/react/agent";

export const agent = createAgent();

/**
 * Registers UI SDK's snapshot/act/query tools with WebMCP when the browser supports it.
 * Safe no-op in browsers without `document.modelContext`.
 */
export const unregisterAgentTools = registerTools(agent, {
  allow: () => true,
});
