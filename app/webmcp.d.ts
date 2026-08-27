type WebMCPTool = {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
  execute: (input: Record<string, unknown>) => unknown | Promise<unknown>;
};

type WebMCPContext = {
  registerTool: (tool: WebMCPTool, options?: { signal?: AbortSignal }) => Promise<void>;
};

declare global {
  interface Document { modelContext?: WebMCPContext }
  interface Navigator { modelContext?: WebMCPContext }
}

export {};
