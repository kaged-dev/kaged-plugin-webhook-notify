import type { SystemPlugin, SystemPluginContext } from "@kaged/plugin-types";

interface WebhookConfig {
	webhook_url: string;
	method?: string;
	include_token?: boolean;
	body_template?: string;
	headers?: Record<string, string>;
	timeout_ms?: number;
	retry_count?: number;
	retry_delay_ms?: number;
}

function clamp(
	value: number,
	min: number,
	max: number,
	label: string,
	log: SystemPluginContext["log"],
): number {
	if (value < min) {
		log.warn(`${label} clamped to minimum ${min} (was ${value})`);
		return min;
	}
	if (value > max) {
		log.warn(`${label} clamped to maximum ${max} (was ${value})`);
		return max;
	}
	return value;
}

function validateConfig(
	cfg: WebhookConfig,
	log: SystemPluginContext["log"],
): {
	webhookUrl: string;
	method: string;
	includeToken: boolean;
	bodyTemplate: string;
	headers: Record<string, string>;
	timeoutMs: number;
	retryCount: number;
	retryDelayMs: number;
} {
	if (!cfg.webhook_url) {
		throw new Error("webhook_url is required");
	}

	const url = cfg.webhook_url;
	const method = cfg.method ?? "POST";
	if (method !== "POST" && method !== "PUT") {
		throw new Error(`method must be "POST" or "PUT", got "${method}"`);
	}

	const bodyTemplate = cfg.body_template ?? "🔑 kaged launch URL:\n{{url}}";
	if (!bodyTemplate.includes("{{url}}")) {
		log.warn(
			"body_template does not contain {{url}} — launch URL will not be included in the body",
		);
	}

	const headers: Record<string, string> = { "Content-Type": "text/plain", ...cfg.headers };
	const timeoutMs = clamp(cfg.timeout_ms ?? 5000, 1000, 30000, "timeout_ms", log);
	const retryCount = clamp(cfg.retry_count ?? 2, 0, 5, "retry_count", log);
	const retryDelayMs = cfg.retry_delay_ms ?? 1000;

	return {
		webhookUrl: url,
		method,
		includeToken: cfg.include_token !== false,
		bodyTemplate,
		headers,
		timeoutMs,
		retryCount,
		retryDelayMs,
	};
}

function stripToken(url: string): string {
	try {
		const parsed = new URL(url);
		parsed.searchParams.delete("token");
		return parsed.toString();
	} catch {
		return url.replace(/[?&]token=[^&]*/, "");
	}
}

export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface WebhookNotifyOptions {
	fetchFn?: FetchFn;
	delayFn?: (ms: number) => Promise<void>;
	insecure?: boolean;
}

export function createWebhookNotifyPlugin(options?: WebhookNotifyOptions): SystemPlugin {
	const fetchFn = options?.fetchFn ?? globalThis.fetch;
	const delayFn = options?.delayFn ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
	const insecure = options?.insecure ?? false;

	return {
		name: "webhook-notify",
		version: "0.1.0",
		description: "POST launch URL to a webhook on auth events",

		setup(ctx: SystemPluginContext) {
			const cfg = ctx.config as unknown as WebhookConfig;
			const validated = validateConfig(cfg, ctx.log);

			if (!insecure && validated.webhookUrl.startsWith("http://")) {
				throw new Error(
					"webhook_url uses http:// but daemon is not in insecure mode. " +
						"Use https:// or start the daemon with --insecure.",
				);
			}

			ctx.on("auth.launchUrlReady", async (url: string) => {
				const finalUrl = validated.includeToken ? url : stripToken(url);
				const body = validated.bodyTemplate.replace("{{url}}", finalUrl);

				let lastError: string | undefined;
				for (let attempt = 0; attempt <= validated.retryCount; attempt++) {
					try {
						const res = await fetchFn(validated.webhookUrl, {
							method: validated.method,
							headers: validated.headers,
							body,
							signal: AbortSignal.timeout(validated.timeoutMs),
						});
						if (res.ok) {
							ctx.log.info("delivered launch URL", { status: res.status });
							return;
						}
						lastError = `HTTP ${res.status}`;
						ctx.log.warn("webhook returned non-2xx", { status: res.status, attempt });
					} catch (err) {
						lastError = err instanceof Error ? err.message : String(err);
						ctx.log.warn("webhook request failed", { error: lastError, attempt });
					}
					if (attempt < validated.retryCount) {
						await delayFn(validated.retryDelayMs);
					}
				}
				ctx.log.error("failed to deliver launch URL after retries", { lastError });
			});
		},
	};
}

const plugin: SystemPlugin = createWebhookNotifyPlugin();

export default plugin;
