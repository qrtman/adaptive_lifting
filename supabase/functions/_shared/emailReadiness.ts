export interface EmailRegistrationConfig {
  emailProviderApiKey?: string | null;
  emailFrom?: string | null;
  appUrl?: string;
  allowedOrigins: string[];
  appEnv?: string;
  cookieSecure?: boolean;
}

export interface EmailDeliverySettings {
  apiKey?: string;
  emailFrom?: string;
  appUrl?: string;
}

/**
 * Fail closed before creating an unverified account when delivery is not
 * configured. `readFallback` reads only the private Vault-backed config RPC.
 */
export async function requireEmailRegistrationReady(
  config: EmailRegistrationConfig,
  readFallback: () => Promise<EmailDeliverySettings>,
): Promise<void> {
  let apiKey = config.emailProviderApiKey?.trim() || '';
  let emailFrom = config.emailFrom?.trim() || '';
  let appUrl = config.appUrl?.trim() || '';
  if (!apiKey || !emailFrom || !appUrl) {
    try {
      const fallback = await readFallback();
      apiKey ||= fallback.apiKey?.trim() || '';
      emailFrom ||= fallback.emailFrom?.trim() || '';
      appUrl ||= fallback.appUrl?.trim() || '';
    } catch {
      throw new Error('email delivery configuration unavailable');
    }
  }
  if (!apiKey || !emailFrom || !appUrl) throw new Error('email delivery configuration unavailable');

  let origin: string;
  try { origin = new URL(appUrl).origin; } catch {
    throw new Error('email application origin is invalid');
  }
  const productionLike = config.appEnv === 'production' || config.cookieSecure === true;
  if ((productionLike && !origin.startsWith('https://')) || !config.allowedOrigins.includes(origin)) {
    throw new Error('email application origin is not an allowed origin');
  }
}
