// Vendored from kaged monorepo packages/plugin-types/src/index.ts — keep in
// sync until @kaged/plugin-types is published to npm, then replace with a
// devDependency (imports are type-only; tsconfig "paths" maps the specifier here).
/**
 * @kaged/plugin-types — Public interface types for kaged system plugins.
 *
 * This package is published separately so system plugin authors can
 * `import type { SystemPlugin } from "@kaged/plugin-types"` without
 * depending on the daemon.
 */

// ── Hook signatures ────────────────────────────────────────────────────

/** Info passed to `daemon.ready` hook. */
export interface DaemonReadyInfo {
	readonly port: number;
	readonly baseUrl: string;
	readonly mode: string;
}

/** Info passed to `auth.cookieIssued` hook. */
export interface CookieIssuedInfo {
	readonly userId: string;
	readonly sessionId: string;
}

/**
 * Daemon lifecycle hooks a system plugin may subscribe to.
 *
 * Each key maps to a callback signature.  The daemon calls registered
 * callbacks sequentially (in plugin-load order) and awaits each one
 * with a per-callback timeout.
 */
export interface DaemonHooks {
	/** Fires after the launch URL file is written — on boot and on every token regeneration. */
	"auth.launchUrlReady": (url: string) => void | Promise<void>;

	/** Fires after the daemon sets the kaged_session cookie on a successful launch-token exchange. */
	"auth.cookieIssued": (info: CookieIssuedInfo) => void | Promise<void>;

	/** Fires after the HTTP server is listening and all startup gates have passed. */
	"daemon.ready": (info: DaemonReadyInfo) => void | Promise<void>;

	/** Fires at the start of graceful shutdown, before teardown() is called on plugins. */
	"daemon.shutdown": () => void | Promise<void>;

	/** Fires when the plugin's own config section in local.toml changes. */
	"config.updated": (newConfig: Record<string, unknown>) => void | Promise<void>;
}

/** Union of all hook names. */
export type HookName = keyof DaemonHooks;

// ── Logger ─────────────────────────────────────────────────────────────

/** Structured logger scoped to a single system plugin. */
export interface PluginLogger {
	info(msg: string, data?: Record<string, unknown>): void;
	warn(msg: string, data?: Record<string, unknown>): void;
	error(msg: string, data?: Record<string, unknown>): void;
	debug(msg: string, data?: Record<string, unknown>): void;
}

// ── Context ────────────────────────────────────────────────────────────

/**
 * The context object passed to `SystemPlugin.setup()`.
 *
 * This is the plugin's sole API surface — all daemon interaction goes
 * through it.
 */
export interface SystemPluginContext {
	/** The plugin's config from `local.toml` `[system_plugins.<name>].config`. */
	readonly config: Record<string, unknown>;

	/** Structured logger scoped to this plugin. */
	readonly log: PluginLogger;

	/** Register a callback on a daemon lifecycle hook. */
	on<H extends HookName>(hook: H, callback: DaemonHooks[H]): void;

	/** Unregister a previously registered callback. */
	off<H extends HookName>(hook: H, callback: DaemonHooks[H]): void;
}

// ── Plugin interface ───────────────────────────────────────────────────

/**
 * The contract a system plugin must satisfy.
 *
 * A system plugin is a TypeScript package whose default export is an
 * object implementing this interface.
 */
export interface SystemPlugin {
	/** Plugin identifier.  Must match the key in local config. */
	readonly name: string;

	/** Semver version.  Informational; shown in logs and status. */
	readonly version: string;

	/** One-line description.  Shown in `kaged system-plugin list`. */
	readonly description: string;

	/**
	 * Called once after the daemon imports the plugin.
	 * The plugin registers hooks on `ctx` and performs any setup.
	 * May be async (daemon awaits before proceeding to next plugin).
	 */
	setup(ctx: SystemPluginContext): void | Promise<void>;

	/**
	 * Called during daemon graceful shutdown.
	 * The plugin should flush state and release resources.
	 * Timeout: 5 seconds.  If the promise doesn't resolve, the daemon
	 * logs a warning and continues.
	 */
	teardown?(): void | Promise<void>;
}

// ── Plugin state ───────────────────────────────────────────────────────

/** Runtime state of a loaded (or failed) system plugin. */
export type SystemPluginState = "disabled" | "loading" | "active" | "stopped" | "failed";
