import { describe, expect, mock, test } from "bun:test";
import type { PluginLogger, SystemPluginContext } from "@kaged/plugin-types";
import { createWebhookNotifyPlugin, type FetchFn } from "../src/index.ts";

function requireValue<T>(value: T | null | undefined): T {
	expect(value).toBeDefined();
	if (value === null || value === undefined) {
		throw new Error("Expected value to be defined");
	}
	return value;
}

type HookCallback = (url: string) => void | Promise<void>;

function makeCtx(
	config: Record<string, unknown>,
	overrides?: Partial<{ log: PluginLogger }>,
): SystemPluginContext & { hooks: Map<string, HookCallback[]> } {
	const hooks = new Map<string, HookCallback[]>();
	const log: PluginLogger = overrides?.log ?? {
		info: mock(() => {}),
		warn: mock(() => {}),
		error: mock(() => {}),
		debug: mock(() => {}),
	};
	return {
		config,
		log,
		hooks,
		on(hook: string, cb: unknown) {
			let list = hooks.get(hook);
			if (!list) {
				list = [];
				hooks.set(hook, list);
			}
			list.push(cb as HookCallback);
		},
		off(hook: string, cb: unknown) {
			const list = hooks.get(hook);
			if (!list) return;
			const idx = list.indexOf(cb as HookCallback);
			if (idx !== -1) list.splice(idx, 1);
		},
	} as unknown as SystemPluginContext & { hooks: Map<string, HookCallback[]> };
}

function noDelay() {
	return async () => {};
}

describe("webhook-notify", () => {
	describe("setup validation", () => {
		test("missing webhook_url → throws", () => {
			const plugin = createWebhookNotifyPlugin();
			const ctx = makeCtx({});
			expect(() => plugin.setup(ctx)).toThrow("webhook_url is required");
		});

		test("invalid method → throws", () => {
			const plugin = createWebhookNotifyPlugin();
			const ctx = makeCtx({ webhook_url: "https://example.com/hook", method: "DELETE" });
			expect(() => plugin.setup(ctx)).toThrow('method must be "POST" or "PUT"');
		});

		test("http:// without insecure → throws", () => {
			const plugin = createWebhookNotifyPlugin({ insecure: false });
			const ctx = makeCtx({ webhook_url: "http://example.com/hook" });
			expect(() => plugin.setup(ctx)).toThrow("http://");
		});

		test("http:// with insecure → loads OK", () => {
			const plugin = createWebhookNotifyPlugin({
				insecure: true,
				fetchFn: mock<FetchFn>(() => Promise.resolve(new Response("ok", { status: 200 }))),
			});
			const ctx = makeCtx({ webhook_url: "http://example.com/hook" });
			expect(() => plugin.setup(ctx)).not.toThrow();
		});

		test("body_template without {{url}} → warns but loads", () => {
			const log: PluginLogger = {
				info: mock(() => {}),
				warn: mock(() => {}),
				error: mock(() => {}),
				debug: mock(() => {}),
			};
			const plugin = createWebhookNotifyPlugin({
				fetchFn: mock<FetchFn>(() => Promise.resolve(new Response("ok", { status: 200 }))),
			});
			const ctx = makeCtx(
				{ webhook_url: "https://example.com/hook", body_template: "kaged is up" },
				{ log },
			);
			plugin.setup(ctx);
			expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("{{url}}"));
		});

		test("timeout_ms out of range → clamped", () => {
			const log: PluginLogger = {
				info: mock(() => {}),
				warn: mock(() => {}),
				error: mock(() => {}),
				debug: mock(() => {}),
			};
			const plugin = createWebhookNotifyPlugin({
				fetchFn: mock<FetchFn>(() => Promise.resolve(new Response("ok", { status: 200 }))),
			});
			const ctx = makeCtx({ webhook_url: "https://example.com/hook", timeout_ms: 500 }, { log });
			plugin.setup(ctx);
			expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("timeout_ms"));
		});

		test("retry_count out of range → clamped", () => {
			const log: PluginLogger = {
				info: mock(() => {}),
				warn: mock(() => {}),
				error: mock(() => {}),
				debug: mock(() => {}),
			};
			const plugin = createWebhookNotifyPlugin({
				fetchFn: mock<FetchFn>(() => Promise.resolve(new Response("ok", { status: 200 }))),
			});
			const ctx = makeCtx({ webhook_url: "https://example.com/hook", retry_count: 10 }, { log });
			plugin.setup(ctx);
			expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("retry_count"));
		});
	});

	describe("hook behavior", () => {
		test("happy path: POSTs launch URL to webhook", async () => {
			const fetchFn = mock<FetchFn>(() => Promise.resolve(new Response("ok", { status: 200 })));
			const plugin = createWebhookNotifyPlugin({ fetchFn, delayFn: noDelay() });
			const ctx = makeCtx({ webhook_url: "https://example.com/hook" });
			plugin.setup(ctx);

			const callbacks = ctx.hooks.get("auth.launchUrlReady");
			expect(callbacks).toHaveLength(1);

			await callbacks?.[0]?.("https://localhost:13000/launch?token=abc123");

			expect(fetchFn).toHaveBeenCalledTimes(1);
			const call = requireValue(fetchFn.mock.calls[0]);
			expect(call[0]).toBe("https://example.com/hook");
			expect(call[1]?.method).toBe("POST");
			expect(call[1]?.body).toContain("https://localhost:13000/launch?token=abc123");
		});

		test("include_token: false strips token from URL", async () => {
			const fetchFn = mock<FetchFn>(() => Promise.resolve(new Response("ok", { status: 200 })));
			const plugin = createWebhookNotifyPlugin({ fetchFn, delayFn: noDelay() });
			const ctx = makeCtx({
				webhook_url: "https://example.com/hook",
				include_token: false,
			});
			plugin.setup(ctx);

			const callbacks = ctx.hooks.get("auth.launchUrlReady");
			await callbacks?.[0]?.("https://localhost:13000/launch?token=abc123");

			const body = fetchFn.mock.calls[0]?.[1]?.body as string;
			expect(body).not.toContain("abc123");
			expect(body).toContain("https://localhost:13000/launch");
		});

		test("custom body_template applied", async () => {
			const fetchFn = mock<FetchFn>(() => Promise.resolve(new Response("ok", { status: 200 })));
			const plugin = createWebhookNotifyPlugin({ fetchFn, delayFn: noDelay() });
			const ctx = makeCtx({
				webhook_url: "https://example.com/hook",
				body_template: "Link: {{url}} -- end",
			});
			plugin.setup(ctx);

			const callbacks = ctx.hooks.get("auth.launchUrlReady");
			await callbacks?.[0]?.("https://localhost:13000/launch?token=xyz");

			const body = fetchFn.mock.calls[0]?.[1]?.body as string;
			expect(body).toBe("Link: https://localhost:13000/launch?token=xyz -- end");
		});

		test("custom headers merged with defaults", async () => {
			const fetchFn = mock<FetchFn>(() => Promise.resolve(new Response("ok", { status: 200 })));
			const plugin = createWebhookNotifyPlugin({ fetchFn, delayFn: noDelay() });
			const ctx = makeCtx({
				webhook_url: "https://example.com/hook",
				headers: { "X-Custom": "value" },
			});
			plugin.setup(ctx);

			const callbacks = ctx.hooks.get("auth.launchUrlReady");
			await callbacks?.[0]?.("https://localhost:13000/launch?token=abc");

			const headers = fetchFn.mock.calls[0]?.[1]?.headers as Record<string, string>;
			expect(headers["Content-Type"]).toBe("text/plain");
			expect(headers["X-Custom"]).toBe("value");
		});

		test("PUT method used when configured", async () => {
			const fetchFn = mock<FetchFn>(() => Promise.resolve(new Response("ok", { status: 200 })));
			const plugin = createWebhookNotifyPlugin({ fetchFn, delayFn: noDelay() });
			const ctx = makeCtx({
				webhook_url: "https://example.com/hook",
				method: "PUT",
			});
			plugin.setup(ctx);

			const callbacks = ctx.hooks.get("auth.launchUrlReady");
			await callbacks?.[0]?.("https://localhost:13000/launch?token=abc");

			expect(fetchFn.mock.calls[0]?.[1]?.method).toBe("PUT");
		});

		test("retries on non-2xx response", async () => {
			let callCount = 0;
			const fetchFn = mock<FetchFn>(() => {
				callCount++;
				if (callCount <= 2) {
					return Promise.resolve(new Response("fail", { status: 500 }));
				}
				return Promise.resolve(new Response("ok", { status: 200 }));
			});

			const log: PluginLogger = {
				info: mock(() => {}),
				warn: mock(() => {}),
				error: mock(() => {}),
				debug: mock(() => {}),
			};
			const plugin = createWebhookNotifyPlugin({ fetchFn, delayFn: noDelay() });
			const ctx = makeCtx({ webhook_url: "https://example.com/hook", retry_count: 2 }, { log });
			plugin.setup(ctx);

			const callbacks = ctx.hooks.get("auth.launchUrlReady");
			await callbacks?.[0]?.("https://localhost:13000/launch?token=abc");

			expect(fetchFn).toHaveBeenCalledTimes(3);
			expect(log.info).toHaveBeenCalledWith("delivered launch URL", { status: 200 });
		});

		test("retries on network error", async () => {
			let callCount = 0;
			const fetchFn = mock<FetchFn>(() => {
				callCount++;
				if (callCount === 1) {
					return Promise.reject(new Error("network error"));
				}
				return Promise.resolve(new Response("ok", { status: 200 }));
			});

			const plugin = createWebhookNotifyPlugin({ fetchFn, delayFn: noDelay() });
			const ctx = makeCtx({
				webhook_url: "https://example.com/hook",
				retry_count: 1,
			});
			plugin.setup(ctx);

			const callbacks = ctx.hooks.get("auth.launchUrlReady");
			await callbacks?.[0]?.("https://localhost:13000/launch?token=abc");

			expect(fetchFn).toHaveBeenCalledTimes(2);
		});

		test("all retries exhausted → error logged, no throw", async () => {
			const fetchFn = mock<FetchFn>(() => Promise.resolve(new Response("fail", { status: 500 })));
			const log: PluginLogger = {
				info: mock(() => {}),
				warn: mock(() => {}),
				error: mock(() => {}),
				debug: mock(() => {}),
			};
			const plugin = createWebhookNotifyPlugin({ fetchFn, delayFn: noDelay() });
			const ctx = makeCtx({ webhook_url: "https://example.com/hook", retry_count: 1 }, { log });
			plugin.setup(ctx);

			const callbacks = ctx.hooks.get("auth.launchUrlReady");
			await callbacks?.[0]?.("https://localhost:13000/launch?token=abc");

			expect(fetchFn).toHaveBeenCalledTimes(2);
			expect(log.error).toHaveBeenCalledWith(
				"failed to deliver launch URL after retries",
				expect.objectContaining({ lastError: "HTTP 500" }),
			);
		});

		test("zero retries → single attempt only", async () => {
			const fetchFn = mock<FetchFn>(() => Promise.resolve(new Response("fail", { status: 500 })));
			const plugin = createWebhookNotifyPlugin({ fetchFn, delayFn: noDelay() });
			const ctx = makeCtx({
				webhook_url: "https://example.com/hook",
				retry_count: 0,
			});
			plugin.setup(ctx);

			const callbacks = ctx.hooks.get("auth.launchUrlReady");
			await callbacks?.[0]?.("https://localhost:13000/launch?token=abc");

			expect(fetchFn).toHaveBeenCalledTimes(1);
		});

		test("delay function called between retries", async () => {
			const delays: number[] = [];
			const delayFn = async (ms: number) => {
				delays.push(ms);
			};
			const fetchFn = mock<FetchFn>(() => Promise.resolve(new Response("fail", { status: 500 })));
			const plugin = createWebhookNotifyPlugin({ fetchFn, delayFn });
			const ctx = makeCtx({
				webhook_url: "https://example.com/hook",
				retry_count: 2,
				retry_delay_ms: 750,
			});
			plugin.setup(ctx);

			const callbacks = ctx.hooks.get("auth.launchUrlReady");
			await callbacks?.[0]?.("https://localhost:13000/launch?token=abc");

			expect(delays).toEqual([750, 750]);
		});
	});

	describe("metadata", () => {
		test("plugin has correct name, version, description", () => {
			const plugin = createWebhookNotifyPlugin();
			expect(plugin.name).toBe("webhook-notify");
			expect(plugin.version).toBe("0.1.0");
			expect(plugin.description).toBe("POST launch URL to a webhook on auth events");
		});
	});
});
