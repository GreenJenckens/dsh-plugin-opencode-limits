window.__ModuleLoader__.load({
	id: "dsh-plugin-opencode-limits",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let React = require("react");

		//#region helpers
		const ENDPOINT = "x/opencode-limits";
		const POLL_MS = 15000;
		const WINDOWS = [
			{ key: "rolling", label: "5ч", full: "5-часовое окно" },
			{ key: "weekly", label: "нед", full: "недельное окно" },
			{ key: "monthly", label: "мес", full: "месячное окно" }
		];
		const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

		function pad(value) {
			return String(value).padStart(2, "0");
		}

		function clock(iso) {
			if (!iso) return null;
			const date = new Date(iso);
			if (Number.isNaN(date.getTime())) return null;
			return pad(date.getHours()) + ":" + pad(date.getMinutes());
		}

		function day(iso) {
			if (!iso) return null;
			const date = new Date(iso);
			if (Number.isNaN(date.getTime())) return null;
			return date.getDate() + " " + MONTHS[date.getMonth()];
		}

		function clamp(value, low, high) {
			return Math.min(high, Math.max(low, value));
		}

		/**
		* Warning colour for one window, or undefined while it is comfortably below
		* its limit — so a healthy row stays as quiet as the harness's own pills.
		*/
		function severity(percent, status) {
			if (status === "rate-limited" || percent >= 95) return "var(--dsw-alias-label-error)";
			if (percent >= 85) return "var(--dsw-alias-state-warn-label)";
			return undefined;
		}

		function duration(iso, now) {
			const target = new Date(iso).getTime();
			if (Number.isNaN(target)) return "?";
			let seconds = Math.max(0, Math.round((target - now) / 1000));
			const days = Math.floor(seconds / 86400);
			seconds -= days * 86400;
			const hours = Math.floor(seconds / 3600);
			seconds -= hours * 3600;
			const minutes = Math.floor(seconds / 60);
			if (days > 0) return days + " д " + hours + " ч";
			if (hours > 0) return hours + " ч " + minutes + " м";
			return minutes + " м";
		}

		function ago(iso) {
			if (!iso) return null;
			const age = Date.now() - new Date(iso).getTime();
			if (!Number.isFinite(age) || age < 0) return "только что";
			const seconds = Math.round(age / 1000);
			if (seconds < 60) return "только что";
			const minutes = Math.round(seconds / 60);
			return minutes + " мин назад";
		}

		function endpointUrl(force) {
			let url;
			try {
				url = new URL(ENDPOINT, document.baseURI);
			} catch {
				url = new URL("/" + ENDPOINT, "http://127.0.0.1/");
			}
			if (force) url.searchParams.set("refresh", "1");
			return url.href;
		}

		async function readLimits(force) {
			const response = await fetch(endpointUrl(force), {
				method: "GET",
				headers: { accept: "application/json" },
				credentials: "same-origin",
				cache: "no-store"
			});
			if (!response.ok) throw new Error("HTTP " + response.status);
			return response.json();
		}
		//#endregion

		//#region styles — the same tokens and metrics as the composer stat pills
		const anchorStyle = {
			minWidth: 0,
			fontSize: "calc(var(--dsh-content-font-size-secondary,13px) - 1px)",
			lineHeight: "calc(20px + var(--dsh-content-font-delta-secondary,0px))",
			display: "inline-flex"
		};
		function pillStyle(hovered) {
			return {
				boxSizing: "border-box",
				borderRadius: "var(--dsw-radius-sm)",
				maxWidth: "100%",
				color: hovered ? "var(--dsw-alias-label-secondary)" : "var(--dsw-alias-label-tertiary)",
				background: hovered ? "var(--dsw-alias-interactive-bg-hover)" : "none",
				border: "none",
				font: "inherit",
				fontVariantNumeric: "tabular-nums",
				lineHeight: "inherit",
				whiteSpace: "nowrap",
				alignItems: "center",
				gap: "6px",
				padding: "1px 8px",
				display: "inline-flex",
				cursor: "pointer"
			};
		}
		const labelStyle = { display: "inline-flex", alignItems: "center", minWidth: 0, overflow: "hidden" };
		const nameStyle = { opacity: 0.75, marginRight: "6px" };
		const sepStyle = { color: "var(--dsw-alias-separator-primary)", margin: "0 5px" };
		const partStyle = { display: "inline-flex", alignItems: "center", gap: "4px" };
		//#endregion

		//#region ring — the shell's context meter geometry, reused per window
		const RING_RADIUS = 5.5;
		const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

		/** 14×14 ring: `--dsw-alias-border-l3` track, round-capped arc from twelve o'clock. */
		function Ring({ percent, color }) {
			const filled = typeof percent === "number" && Number.isFinite(percent) ? clamp(percent, 0, 100) : 0;
			return React.createElement(
				"svg",
				{ viewBox: "0 0 14 14", width: 14, height: 14, "aria-hidden": true, style: { flex: "none" } },
				React.createElement("circle", {
					cx: 7,
					cy: 7,
					r: RING_RADIUS,
					style: { fill: "none", stroke: "var(--dsw-alias-border-l3)", strokeWidth: 2 }
				}),
				React.createElement("circle", {
					cx: 7,
					cy: 7,
					r: RING_RADIUS,
					style: {
						fill: "none",
						stroke: color || "var(--dsw-alias-label-tertiary)",
						strokeWidth: 2,
						strokeLinecap: "round",
						strokeDasharray: (RING_CIRCUMFERENCE * filled) / 100 + " " + RING_CIRCUMFERENCE,
						transform: "rotate(-90deg)",
						transformOrigin: "center",
						transition: "stroke-dasharray 600ms ease, stroke 300ms ease"
					}
				})
			);
		}
		//#endregion

		//#region component
		function LimitsPill() {
			const [state, setState] = React.useState({ phase: "loading" });
			const [now, setNow] = React.useState(() => Date.now());
			const [busy, setBusy] = React.useState(false);
			const [hovered, setHovered] = React.useState(false);

			const load = React.useCallback((force) => {
				let alive = true;
				if (force) setBusy(true);
				readLimits(force)
					.then((data) => {
						if (!alive) return;
						setBusy(false);
						setNow(Date.now());
						setState({ phase: "ok", data });
					})
					.catch((error) => {
						if (!alive) return;
						setBusy(false);
						setState((previous) => ({
							phase: previous.phase === "ok" ? "stale" : "error",
							data: previous.data,
							error: String((error && error.message) || error)
						}));
					});
				return () => {
					alive = false;
				};
			}, []);

			React.useEffect(() => {
				const cancel = load(false);
				const poll = setInterval(() => load(false), POLL_MS);
				const tick = setInterval(() => setNow(Date.now()), 5000);
				const onVisible = () => {
					if (!document.hidden) load(false);
				};
				document.addEventListener("visibilitychange", onVisible);
				return () => {
					cancel();
					clearInterval(poll);
					clearInterval(tick);
					document.removeEventListener("visibilitychange", onVisible);
				};
			}, [load]);

			const data = state.data;
			const usage = data && data.usage ? data.usage : undefined;
			const failed = state.phase === "error" || (data && data.ok === false);
			const loading = state.phase === "loading" && !data;

			const parts = [];
			if (usage !== undefined) {
				WINDOWS.forEach((window) => {
					const entry = usage[window.key];
					if (!entry || typeof entry !== "object") return;
					const used = typeof entry.percent === "number" ? clamp(entry.percent, 0, 100) : null;
					const free = used === null ? null : Math.max(0, Math.round((100 - used) * 10) / 10);
					const blocked = entry.status === "rate-limited";
					const reset = clock(entry.resetsAt);
					parts.push({
						key: window.key,
						text: window.label + " " + (blocked ? "лимит" : free === null ? "—" : free + "%"),
						free: blocked ? 0 : free,
						color: used === null ? undefined : severity(used, entry.status),
						title:
							window.full +
							": " +
							(blocked ? "лимит исчерпан" : free === null ? "нет данных" : "свободно " + free + "%") +
							(reset
								? " · сброс " + (day(entry.resetsAt) ? day(entry.resetsAt) + ", " : "") + reset + " (через " + duration(entry.resetsAt, now) + ")"
								: "")
					});
				});
			}

			const title = failed
				? "OpenCode Go: " + (state.error || (data && data.error) || "нет данных")
				: usage === undefined
					? "OpenCode Go: загружаю…"
					: "OpenCode Go · ключ: " + (data.keySource || "?") + " · обновлено " + (ago(data.fetchedAt) || "только что") + " · клик — обновить";

			const detail = failed ? state.error || (data && data.error) || null : null;
			const statusText = loading ? "загружаю…" : failed ? "нет данных" + (detail ? " (" + detail + ")" : "") : null;

			const textChildren = [React.createElement("span", { key: "name", style: nameStyle }, "OpenCode")];
			if (statusText !== null) {
				textChildren.push(
					React.createElement("span", { key: "status", style: { color: failed ? "var(--dsw-alias-label-error)" : undefined } }, statusText)
				);
			} else {
				parts.forEach((part, index) => {
					if (index > 0) {
						textChildren.push(React.createElement("span", { key: "sep-" + part.key, style: sepStyle }, "·"));
					}
					textChildren.push(
						React.createElement(
							"span",
							{ key: part.key, title: part.title, style: partStyle },
							React.createElement(Ring, { percent: part.free, color: part.color }),
							React.createElement("span", { style: { color: part.color } }, part.text)
						)
					);
				});
			}

			const children = [React.createElement("span", { key: "label", style: labelStyle }, textChildren)];

			return React.createElement(
				"span",
				{ style: anchorStyle, "data-composer-stat": "opencode-limits" },
				React.createElement(
					"button",
					{
						type: "button",
						title,
						"aria-label": title,
						onClick: () => {
							if (!busy) load(true);
						},
						onMouseEnter: () => setHovered(true),
						onMouseLeave: () => setHovered(false),
						style: { ...pillStyle(hovered), opacity: busy ? 0.6 : 1 }
					},
					children
				)
			);
		}
		//#endregion

		//#region plugin
		const inject = ["slots"];

		function apply(ctx) {
			// The composer dock is the centred row under the input, where the harness
			// shows steps, decode speed, token totals and cache hit.
			ctx.slots.inject("conversation.composer.dock", () =>
				ctx.slots.register(
					{ name: "conversation.composer.dock", id: "opencode-limits", order: 2 },
					LimitsPill
				)
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
