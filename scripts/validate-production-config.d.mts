export function validateProductionConfig(options?: { local?: boolean }): {
  prod: Record<string, any>;
  staging: Record<string, any>;
  env: Map<string, string>;
  versions: string[];
};
