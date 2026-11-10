export type AppPromptOptions = {
  title?: string;
  message: string;
  defaultValue?: string;
  confirmText?: string;
  cancelText?: string;
  multiline?: boolean;
  allowEmpty?: boolean;
  placeholder?: string;
};

export type AppPromptRequest = AppPromptOptions & {
  id: number;
  resolve: (value: string | null) => void;
};

let host: ((request: AppPromptRequest) => void) | null = null;
let nextId = 1;

export function appPrompt(options: AppPromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const request = { ...options, id: nextId++, resolve };
    if (!host) {
      resolve(null);
      return;
    }
    host(request);
  });
}

export function registerAppPromptHost(
  nextHost: (request: AppPromptRequest) => void,
) {
  host = nextHost;
  return () => {
    if (host === nextHost) host = null;
  };
}
